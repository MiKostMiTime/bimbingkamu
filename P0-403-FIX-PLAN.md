# P0 — Fix HTTP 403 Across All Providers (Root Cause + Plan)

**Status:** ✅ IMPLEMENTED + TESTED (5/5 areas done; 152 tests passing)
**Scope:** `js/config.js`, `js/app.js`, `js/api.js`, `js/providers.js`, `js/adapters.js` + new tests.

## IMPLEMENTATION STATUS (all 5 areas complete)

| Area | Root cause | Files | Tests | Result |
|---|---|---|---|---|
| 1 — RC1 API-key isolation | `config.js`: `migrateApiKey()` / `migrateLegacyConfig()`; `app.js` loadSettings wiring + `activeApiKey()` drops legacy fallback. | config.js, app.js | `api-key-isolation.test.js` (11) | ✅ pass |
| 2 — RC2 adapter persistence | `providers.js`: `inferProviderKindAndStrategy()`; `connectEndpoint()` preserves+passes `kind`/`contextStrategy`. | providers.js, app.js | `adapter-persistence.test.js` (7) | ✅ pass |
| 3 — RC3 403 diagnostics | `api.js`: `mapApiError()` splits 401/403 + permission/deployment subtypes; raw body threaded everywhere. | api.js, providers.js | `http403-diagnostics.test.js` (12) | ✅ pass |
| 4 — RC4 local proxy isolation | `providers.js`: `providerFetch()` skips cloud proxy for local/private targets. | providers.js (+ mixed-content test) | `local-proxy-isolation.test.js` (4) | ✅ pass |
| 5 — RC5 refresh race | `app.js`: request-ID seq + AbortController + immediate stale-clear; `providers.js` reads `opts.signal`. | app.js, providers.js | `provider-switch-race.test.js` (3) | ✅ pass |

**Full suite:** `npm test` → **152 passing / 0 failing**. `npm run predeploy` & `npm run build` clean
(bundle rebuilt fresh). Signal fix: `providers.js:providerFetch()` now reads `init.signal || opts.signal`
so `{ signal }` from `listModels()` reaches the fetch.

---

## ROOT CAUSE of the 403

The app returns HTTP 403 for **both Cloud and Local AI**, and switching providers does not
reliably fix it. Investigation found **five compounding root causes** (not one):

### RC1 — Legacy global API key is reused across unrelated providers (primary cause)
`js/providers.js:resolveApiKey()` returns `(p && p.key) || legacyKey || ''`.
`app.js:activeApiKey()` passes the **legacy global key** (`state.apiKey`, stored at
`bimbingkamu.apiKey`) as `legacyKey`.

When a provider has no per-endpoint `key`, its request is sent with the *previous* provider's
global key. A user who pasted an **OpenRouter** key globally then switched to Gemini / OpenAI /
Groq / Anthropic / Local AI had their OpenRouter key forwarded → **403**. Local endpoints (LM
Studio / Ollama) also received a cloud Bearer token even though auth is disabled for them.

### RC2 — Editing an endpoint drops `kind` + `contextStrategy`
`app.js:connectEndpoint()` calls `probeEndpoint(baseUrl, key)` (**no `kind`**) and builds the
saved provider **without** `kind` / `contextStrategy`. On reload `resolveProviders()` applies
`kind: p.kind || 'oi'`, so an edited **Anthropic** endpoint silently reverts to OpenAI-compatible
(Bearer) transport → wrong auth (`Authorization` instead of `x-api-key`) and wrong chat path
(`/chat/completions` instead of `/messages`) → **403**.

### RC3 — Every 403 is classified as "invalid API key"
`js/api.js:mapApiError()` has `if (status === 401 || status === 403) return { type: 'auth' }`.
It also never receives the raw body in `listModels()` / streaming chat, so Cloudflare
"Attention Required!" HTML pages and billing/permission/deployment 403s are all reported as
"kunci API invalid". Misleading → users rotate keys pointlessly.

### RC4 — Local/private requests silently routed to the Vercel cloud proxy
`providerFetch()` always falls back to `/api/proxy` on throw/opaque/timeout. The cloud proxy runs
on Vercel and **cannot reach localhost / private LAN**, so local endpoints get a misleading error
or a silent cloud retry instead of a direct connection (or bridge).

### RC5 — Provider switching has no cancellation → stale responses overwrite current state
`refreshProviderModelList()` is fire-and-forget from the `providerSelect` change handler with no
request-ID / AbortController. Rapid A→B→A switching lets an older response win and restore the
wrong provider's model list / key, re-introducing the 403.

---

## FILES MODIFIED

| File | Change | Area |
|---|---|---|
| `js/config.js` | Add `migrateApiKey()` + `migrateLegacyConfig()`; one-time migration of legacy global key to previously-active provider; remove global fallback after. | 1 |
| `js/app.js` | `loadSettings()` runs combined migration + clears `bimbingkamu.apiKey`; `activeApiKey()` drops legacy fallback; `refreshProviderModelList()` gets request-ID + AbortController + immediate stale-clear; `connectEndpoint()` preserves `kind`/`contextStrategy` and passes it to `probeEndpoint`. | 1, 2, 5 |
| `js/api.js` | `mapApiError()` gains raw-text awareness + finer 403 subtypes (auth / permission / billing / waf / deployment); upstream-vs-proxy 403 distinguished; Cloudflare WAF detection from body; sensitive-field guard in logging. | 3 |
| `js/providers.js` | `providerFetch()` detects local/private targets and **never** forwards them to the cloud proxy (bridge + direct preserved); `probeEndpoint(baseUrl, apiKey, kind)` becomes adapter-aware (`chatPath` per kind); `listModels()`/streaming capture raw body for WAF detection; error detail carries `viaProxy`. | 3, 4 |
| `js/adapters.js` | Minor: expose chat-path derivation helper so probe is kind-correct. | 5 |

## TESTS ADDED (new files under `tests/`)

- `api-key-isolation.test.js` — per-provider key scoping; legacy global migration; no cloud key sent to local-without-auth.
- `provider-switch-race.test.js` — two providers with different keys; rapid switch + out-of-order responses; stale model cleared; SSE after switch.
- `http403-diagnostics.test.js` — direct 403, proxy 403, Cloudflare WAF 403, permission/billing/deployment 403; upstream vs proxy distinction.
- `local-proxy-isolation.test.js` — local endpoint never reaches cloud proxy; LAN/loopback detection; CORS fallback guidance preserved.
- `adapter-persistence.test.js` — editing Anthropic preserves kind + x-api-key + /messages; OpenAI Bearer preserved; modelsPath/chatPath kept.

## VERIFICATION (from task §8)

1. `npm test` — **152 passing / 0 failing** (149 pre-existing + 3 new Area-5 tests). ✅
2. `npm run predeploy` — static build clean; bundle rebuilt fresh (`js/app.bundle.js`). ✅
3. `npm run build` — bundles + minifies CSS, no errors. ✅
4. Existing provider-fetch regression tests still pass (unchanged; covered by the 149). ✅
5. Browser integration: `repro-integration.mjs` (ngrok) + manual Cloud/Local switching in headed Chrome with/without bridge extension. — pending manual run.
6. Cloud AI real switch test (OpenRouter ↔ OpenAI ↔ Anthropic). — pending manual run.
7. Local AI real test (LM Studio / Ollama, auth on & off). — pending manual run.

## KNOWN LIMITATIONS / REMAINING ISSUES

- Migration is **one-time and best-effort**: if the previously-active provider id no longer exists
  anywhere it defaults to `ep-openrouter`. Legacy v1 `provider:'gemini'` users are handled by
  capturing the active id *before* `migrateLegacyProviderSettings` clears it.
- Local proxy-skip changes behavior asserted in `probe-endpoint-local-mixed-content.test.js`
  (proxy was previously tried for local) — that test is updated to reflect "never forward local".

## DEPLOYMENT

1. `npm run build` (bundles `js/*.js` → `js/app.bundle.js`).
2. Commit + push; Vercel deploys. Extension (`lmstudio-bridge/`) unchanged.
3. Post-deploy: open app, add Cloud endpoint with its own key, switch to a second provider with a
   different key, confirm no 403; add local LM Studio/Ollama (with & without auth), confirm direct
   connection + actionable guidance when blocked.
