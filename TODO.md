# Fix: providerFetch() resolves undefined → `.ok` crash after 12s timeout

Root cause: `Promise.race([direct, timedFallback])` in `providerFetch()` can hand
back `undefined` when the 12s timer fires + aborts the direct fetch; the losing
branch's `if (settled) return;` resolves to undefined and wins the race before the
proxy fallback completes. → `chatCompletion()` does `if (!res.ok)` on undefined.

## Tasks
- [x] Diagnose (confirmed via `_fetchLog` timeout entry + code trace)
- [x] Edit providers.js: shared winnerGate so race never returns undefined
- [x] Make DIRECT_TIMEOUT injectable (opts.timeoutMs) for fast tests
- [x] Add regression test tests/provider-fetch-race.test.js (5 tests)
- [x] Run `node --test` and confirm pass (5/5)
- [ ] `npm run build` → regenerate js/app.bundle.js
- [ ] git add + commit
