# Security Hardening — TanyaBukan (2026-11-04)

## Audit findings

### ✅ Already secure (no change)
- **Markdown/XSS**: `renderMarkdown` (chat.js) + `renderMarkdownToHtml` (card.js) → DOMPurify.sanitize w/ escapeHtml fallback. User msgs use textContent. Provider list escapes id/name/key/baseUrl via escapeAttr/escapeHtml.
- **File upload**: size ≤5MB, type+extension detection (.pdf/.docx/.txt/.md), empty-text guard, friendly try/catch errors.
- **No inline handlers / eval / document.write / Worker** → CSP-compatible; app uses addEventListener throughout.
- **Vendor migration**: marked, dompurify, pdf.js, KaTeX, mammoth, html2canvas + Inter font all local (vendor/), licenses in vendor/licenses/.
- **API keys**: localStorage (client-side only — no backend). Not hardcoded.

### 🐛 Fixed
1. **KaTeX import path regression** (functional): `js/math.js` dynamic `import('./vendor/katex/katex.mjs')` resolves against math.js's location (`/js/`) → `/js/vendor/...` 404. Proven via node test (`ERR_MODULE_NOT_FOUND`). Fix: `../vendor/katex/katex.mjs`. (CSS `<link>` uses DOM element → resolves vs document base, so `./vendor/...` stays correct there.)
2. **Model-ID XSS sink** (security): app.js:202 + ui.js:250 injected raw model IDs from endpoint `/models` JSON into `<option value="${id}">${id}</option>` with no escaping. User-configurable baseUrl ⇒ malicious/MITM'd endpoint = DOM XSS. Fix: `sanitizeModelId()` whitelist in providers.js `listModels` (single source for both dropdown paths).

### CSP (verified compatible, no change)
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src https: http:; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; manifest-src 'self'`
- script-src 'self': app.js module, marked/dompurify classic scripts, KaTeX dynamic import (module), pdf/mammoth/html2canvas `<script>.src`, all `./vendor`/root → self ✓
- worker-src 'self': pdf worker via GlobalWorkerOptions.workerSrc = './vendor/pdfjs/...' resolved vs document base → /vendor/... ✓
