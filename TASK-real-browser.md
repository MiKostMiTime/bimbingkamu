# Reproduce `net::ERR_FAILED` in a REAL browser (no extension) → root cause → minimal fix

## Context
- App: `https://bimbingkamu.vercel.app/` (Vercel, HTTPS public). Deployed project `bimbingkamu`.
- Broken endpoint: `https://oyster-regroup-neatness.ngrok-free.dev/v1/models` → `net::ERR_FAILED` status 0.
- Desktop extension (`lmstudio-bridge/`) makes it work by routing fetch through a background SW with `host_permissions`.
- Server-side curl ground-truth: endpoint UP, perfect CORS (`access-control-allow-origin: *`), resolves to **public AWS IPs**, `/v1/models` returns full list. → server is fine.
- Headless Playwright (previous work): all native fetches fail for ngrok, no preflight sent. Uncertain if representative of real browser.

## Goal
Reproduce in a REAL browser (headed Google Chrome for Testing v158), determine root cause
(CORS vs PNA vs app code), then implement minimal fix in `js/` + rebuild so local/ngrok work
without the extension or manual tunnel/CORS setup.

## Steps
1. [ ] Build real-browser harness: headed Chrome (executablePath) + CDP Network trace.
2. [ ] Reproduce on LIVE Vercel app, no extension: capture every ngrok request (method/status/
       CORS headers/preflight/failure reason) + console errors. Compare with OpenRouter control.
3. [ ] Also test LOCAL model path (127.0.0.1) — PNA candidate.
4. [ ] Determine root cause from evidence.
5. [ ] Decide fix path: SW-enhance (Option B, no backend) vs same-origin server proxy at Vercel
       (Option A).
6. [ ] Implement minimal fix in `js/`.
7. [ ] Rebuild (`npm run build`), verify `/v1/models` succeeds without extension.

## Key facts
- CSP in index.html: `connect-src https: http:`; `script-src 'self'`; `worker-src 'self'`.
- App fetches via native `fetch()` in `js/providers.js` (`probeEndpoint`, `listModels`).
- sw.js does network-first `fetch(request)` inside SW context for provider URLs.
- Extension background SW: `fetch(parsed.href, init)` from privileged context (host_permissions).
- Node v22; Playwright 1.65.0; Chrome-for-Testing exe at chromium-1254.
