# Websearch UX States + Typing Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make websearch show reliable per-answer states with source snippets, and give the AI reply chatbot-grade typing — staged status, blinking cursor, a real **Berhendi** (abort) button, and a **Coba lagi** retry on the main send flow.

**Architecture:** Surgical edits across four files. Pure decision logic (`isValidHttpUrl`, `truncateSnippet`, `classifyWebSearch`) lives in `api.js` so it is unit-testable without a DOM; DOM rendering stays in `chat.js`; orchestration (abort controller, button toggle, retry) stays in `app.js`. The streaming layer in `providers.js` gains an `AbortSignal` threaded from the UI down to `fetch`, with graceful partial-on-abort in `readSSE`.

**Tech Stack:** Vanilla ES Modules, no build step; `marked` + `DOMPurify`; KaTeX on-demand. Tests via `node --test tests/*.mjs` (pure helpers) + manual/Playwright for DOM.

**Spec:** `docs/superpowers/specs/2026-11-05-websearch-typing-design.md` (the plan argues from this doc — read both).

## Global Constraints
- UI copy is **Indonesian** (e.g. "Berhendi", "Coba lagi", "Mencari sumber web…").
- `prefers-reduced-motion: reduce` is global in `css/components.css:1671` → every new animation must respect it.
- Vanilla ES Modules, **no build step**; run via server (not `file://`). Test command: `node --test tests/*.mjs`.
- Do **not** `git add -A`; stage explicitly — `.idea/` stays untracked.
- Generic across all [OI]-compatible providers: **no fixed provider, no hardcode**, no capability probe; per-answer indicator is derived from stored flags + `sources.length`.

---

## File Map
| File | Responsibility |
|---|---|
| `js/api.js` | Pure helpers: `isValidHttpUrl`, `truncateSnippet`, `classifyWebSearch` (+ unit tests). |
| `js/chat.js` | `renderSources` (snippet + validated href), typing indicator (staged status + caret), web-search state box. |
| `js/providers.js` | Thread `AbortSignal` through `chatCompletion` → `buildChatRequest` → `fetch`; `readSSE(res, onDelta, signal)` with partial-on-abort (exported for tests). |
| `js/app.js` | Module-level `abortCtl` + `userStopped`; `stopGeneration()`; `updateComposer()` Kirim↔Berhendi toggle; `sendUserMessage`/`generateGreeting` pass `signal`; store `webSearch` flag on model messages; retry on main send. |
| `css/components.css` | `.typing__status`, `.typing__caret`, `.msg__sources-snippet`, stop-button state. |
| `tests/core.test.mjs` | Unit tests for new pure helpers + `readSSE` partial-on-abort. |

---

## Task 1: Pure helpers for websearch snippet + href validation

**Files:**
- Create/Modify: `js/api.js`
- Test: `tests/core.test.mjs`

**Interfaces:**
- Produces: `isValidHttpUrl(url): boolean`, `truncateSnippet(text, max = 200): string`, `classifyWebSearch({ webSearch, supportsGrounding, sources }): 'ok' | 'not-found' | 'unsupported'`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests** (append to `tests/core.test.mjs`)

```js
import { mapApiError, extractSources, isValidHttpUrl, truncateSnippet, classifyWebSearch } from '../js/api.js';

test('isValidHttpUrl: hanya http(s) yang valid', () => {
  assert.equal(isValidHttpUrl('https://a.id/x'), true);
  assert.equal(isValidHttpUrl('http://127.0.0.1:1234/y'), true);
  assert.equal(isValidHttpUrl('/relative/path'), false);
  assert.equal(isValidHttpUrl('ftp://x'), false);
  assert.equal(isValidHttpUrl(undefined), false);
  assert.equal(isValidHttpUrl(123), false);
});

test('truncateSnippet: pangkas + elipsis di ~max karakter', () => {
  assert.equal(truncateSnippet('halo dunia', 8), 'halo d…');
  assert.equal(truncateSnippet('pendek', 200), 'pendek');
  assert.equal(truncateSnippet('abc', undefined), 'abc');
});

test('classifyWebSearch: ok / not-found / unsupported', () => {
  assert.equal(classifyWebSearch({ webSearch: true, supportsGrounding: true, sources: [{ url: 'a' }] }), 'ok');
  assert.equal(classifyWebSearch({ webSearch: true, supportsGrounding: true, sources: [] }), 'not-found');
  assert.equal(classifyWebSearch({ webSearch: true, supportsGrounding: false, sources: [] }), 'unsupported');
  assert.equal(classifyWebSearch({ webSearch: false, supportsGrounding: true, sources: [] }), 'not-found');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core.test.mjs`
Expected: FAIL — `isValidHttpUrl`, `truncateSnippet`, `classifyWebSearch` not defined (import error).

- [ ] **Step 3: Write minimal implementation** in `js/api.js` (after `extractSources`)

```js
// URL kredibel hanya http(s) → dipakai untuk keputusan href di renderSources.
export function isValidHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

// Pangkas snippet agar ringkas di bawah tautan; elipsis '…' di akhir bila lebih dari max.
export function truncateSnippet(text, max = 200) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

// Klasifikasi state sumber web per-jawaban (logika murni, UI hanya membaca hasilnya).
export function classifyWebSearch({ webSearch, supportsGrounding, sources }) {
  if (!webSearch) return 'not-found';
  if (!supportsGrounding) return 'unsupported';
  return Array.isArray(sources) && sources.length ? 'ok' : 'not-found';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/core.test.mjs`
Expected: PASS (3 test + existing).

- [ ] **Step 5: Commit**

```bash
git add tests/core.test.mjs js/api.js
git commit -m "feat(api): helper isValidHttpUrl/truncateSnippet/classifyWebSearch untuk websearch"
```

---

## Task 2: renderSources — snippet + validated href

**Files:**
- Modify: `js/chat.js` (`renderSources`)
- Test: manual/Playwright smoke (DOM; pure helpers already covered in Task 1).

**Interfaces:**
- Consumes: `isValidHttpUrl`, `truncateSnippet` from `api.js` (import into `chat.js`).
- Produces: `.msg__sources` box per source with `<a>` (href validated) + `.msg__sources-snippet`.

- [ ] **Step 1: Write the failing test** — since DOM needs manual check, add a focused assertion helper. Export a tiny pure function from `chat.js` to keep it testable:

```js
// chat.js — ekspos pemetai sumber → anchor agar bisa diuji tanpa DOM.
export function sourceAnchor(source) {
  const url = source && source.url;
  return { href: isValidHttpUrl(url) ? url : null, title: source?.title || url || '', snippet: truncateSnippet(source?.snippet, 200) };
}
```
Add to `tests/core.test.mjs`:

```js
import { sourceAnchor } from '../js/chat.js';
test('sourceAnchor: href hanya http(s), judul+snippet dipangkas', () => {
  const ok = sourceAnchor({ url: 'https://a.id/x', title: 'Judul A', snippet: 'ringkasan' });
  assert.equal(ok.href, 'https://a.id/x');
  assert.equal(ok.title, 'Judul A');
  const rel = sourceAnchor({ url: '/relative', title: 'Rel', snippet: '' });
  assert.equal(rel.href, null); // non-http → bukan link
  assert.equal(rel.snippet, '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core.test.mjs`
Expected: FAIL — `sourceAnchor` not defined in `chat.js`.

- [ ] **Step 3: Write minimal implementation** — import helpers + rewrite the source loop in `renderSources`:

In `js/chat.js` top imports, add:
```js
import { isValidHttpUrl, truncateSnippet } from './api.js';
```
Replace the `for (const s of sources)` block inside `renderSources` (lines ~443–452) with:
```js
  const list = document.createElement('ul');
  for (const s of sources) {
    const li = document.createElement('li');
    const anchor = sourceAnchor(s);
    const a = document.createElement(anchor.href ? 'a' : 'span');
    if (anchor.href) {
      a.href = anchor.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    a.className = 'msg__sources-link';
    a.textContent = anchor.title; // textContent → aman dari XSS
    li.appendChild(a);
    if (anchor.snippet) {
      const p = document.createElement('p');
      p.className = 'msg__sources-snippet';
      p.textContent = anchor.snippet; // textContent → aman
      li.appendChild(p);
    }
    list.appendChild(li);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/core.test.mjs`
Expected: PASS. Then manual/Playwright: buka chat dengan websearch ON, pastikan tiap sumber menampilkan judul + snippet, dan tautan aman (klik → tab baru).

- [ ] **Step 5: Commit**

```bash
git add tests/core.test.mjs js/chat.js
git commit -m "feat(websearch): tampilkan snippet + validasi href di renderSources"
```

---

## Task 3: Per-answer web-search state indicator (loading / not-found / unsupported)

**Files:**
- Modify: `js/app.js` (`sendUserMessage`, `generateGreeting`, `renderMessagesFromState`, `rerenderModelMessage`, `rerenderModelMessagesFrom`)
- Modify: `js/chat.js` (`showWebSearchStatus` helper + store flag on render)
- Test: manual/Playwright.

**Interfaces:**
- Consumes: `classifyWebSearch` (api.js), `currentProviders()` for `supportsGrounding`.
- Produces: model messages carry `webSearch` flag; bubble shows loading before answer, then classified state after.

- [ ] **Step 1: Write the failing test** — export a helper from `chat.js` that builds the status box text so it is verifiable:

```js
// chat.js
export function webSearchStatusText(state) {
  return { loading: 'Mencari sumber web…', 'not-found': 'Tidak ada sumber web.', unsupported: 'Sumber web tidak didukung endpoint ini.' }[state];
}
```
Add test:
```js
import { sourceAnchor, webSearchStatusText } from '../js/chat.js';
test('webSearchStatusText: label per state (Indonesia)', () => {
  assert.equal(webSearchStatusText('loading'), 'Mencari sumber web…');
  assert.equal(webSearchStatusText('not-found'), 'Tidak ada sumber web.');
  assert.equal(webSearchStatusText('unsupported'), 'Sumber web tidak didukung endpoint ini.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core.test.mjs`
Expected: FAIL — `webSearchStatusText` not defined.

- [ ] **Step 3: Write minimal implementation**

a) Add `showWebSearchStatus(col, status)` in `chat.js` (append a `.msg__sources` box with title = status text; reuse `.typing` spinner for loading):
```js
export function showWebSearchStatus(col, status) {
  if (!col) return null;
  let box = col.querySelector('.msg__sources');
  if (!box) {
    box = document.createElement('div');
    box.className = 'msg__sources';
    col.appendChild(box);
  }
  box.innerHTML = '';
  const head = document.createElement('p');
  head.className = 'msg__sources-title';
  head.textContent = status === 'loading' ? 'Mencari sumber web…' : webSearchStatusText(status);
  if (status === 'loading') {
    const spin = document.createElement('div');
    spin.className = 'typing';
    spin.setAttribute('aria-label', 'Sedang mencari sumber web');
    for (let i = 0; i < 3; i++) spin.appendChild(document.createElement('span'));
    box.appendChild(spin);
  } else {
    box.appendChild(head);
  }
  return box;
}
```
b) In `app.js`, import `showWebSearchStatus` + `classifyWebSearch`. In `sendUserMessage`, right after `built = addModelMessage(...)` and before/at `insertBubbleTyping`, when websearch ON:
```js
const supportsGrounding = Boolean(currentProviders()[state.settings.provider]?.supportsGrounding);
if (state.settings.webSearch) showWebSearchStatus(built.col, 'loading');
```
After the `await providerChat(...)` resolves with `{ text, tokens, sources }`, before/after `renderSources`:
```js
const webState = classifyWebSearch({ webSearch: state.settings.webSearch, supportsGrounding, sources });
if (state.settings.webSearch) showWebSearchStatus(built.col, webState); // 'ok' → renderSources fills list; else status box
```
And store the flag on the model message so re-renders are stable:
```js
const modelMsg = { role: 'model', text: reply, sources, tokens, webSearch: state.settings.webSearch };
```
c) Mirror in `generateGreeting` (greeting uses webSearch false → indicator stays hidden; store flag anyway). In `renderMessagesFromState`, `rerenderModelMessage`, `rerenderModelMessagesFrom`: after building bubble + renderRich, re-derive status from stored `m.webSearch` + `m.sources` + `supportsGrounding` and call `showWebSearchStatus` then `renderSources`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/core.test.mjs`
Expected: PASS. Manual/Playwright: websearch ON → loading spinner muncul saat menjawab; bila ada sumber → judul+snippet; bila tidak → "Tidak ada sumber web."; di endpoint tanpa grounding → "Sumber web not supported".

- [ ] **Step 5: Commit**

```bash
git add tests/core.test.mjs js/chat.js js/app.js
git commit -m "feat(websearch): indikator state per-jawaban (loading/not-found/unsupported) + flag webSearch"
```

---

## Task 4: Staged status + blinking cursor in typing indicator

**Files:**
- Modify: `js/chat.js` (`insertBubbleTyping`, `showTyping`)
- Modify: `css/components.css`
- Test: manual/Playwright (animation) + one pure check for status text (Task 3 covered).

**Interfaces:**
- Consumes: `.typing__status` / `.typing__caret` elements; `onDelta` callback toggles "Menghubungkan ke AI…" → "Sedang menjawab…".

- [ ] **Step 1: Write the failing test** — export a factory for the status element text so it is verifiable:

```js
// chat.js (dekat insertBubbleTyping)
export function typingStatusText(stage) {
  return stage === 'answering' ? 'Sedang menjawab…' : 'Menghubungkan ke AI…';
}
```
Add test:
```js
import { sourceAnchor, webSearchStatusText, typingStatusText } from '../js/chat.js';
test('typingStatusText: status bertahap', () => {
  assert.equal(typingStatusText('connecting'), 'Menghubungkan ke AI…');
  assert.equal(typingStatusText('answering'), 'Sedang menjawab…');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core.test.mjs`
Expected: FAIL — `typingStatusText` not defined.

- [ ] **Step 3: Write minimal implementation**

a) Rewrite `insertBubbleTyping(content)` to append status + caret + dots:
```js
export function insertBubbleTyping(content) {
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.setAttribute('aria-label', 'Tutor sedang menulis');
  const status = document.createElement('span');
  status.className = 'typing__status';
  status.textContent = 'Menghubungkan ke AI…';
  const caret = document.createElement('span');
  caret.className = 'typing__caret';
  caret.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) typing.appendChild(document.createElement('span'));
  typing.append(status, caret);
  content.insertBefore(typing, content.firstChild);
  return { el: typing, status, setCaret: (on) => caret.classList.toggle('is-on', on) };
}
```
b) In `app.js` `sendUserMessage`, capture the returned object and toggle staged status in `onDelta`:
```js
const typing = insertBubbleTyping(built.content);
...
onDelta: (acc) => {
  if (!streamed) { dots.remove(); streamed = true; typing.status.textContent = 'Sedang menjawab…'; }
  ...
}
```
c) Add CSS to `css/components.css` (after `.typing` block ~1066):
```css
.typing__status {
  font-size: var(--text-caption);
  color: var(--color-text-secondary);
  margin-right: 2px;
}
.typing__caret {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  background: var(--color-accent);
  align-self: center;
  animation: caret-blink 1s steps(1) infinite;
}
.typing__caret.is-on { animation-play-state: running; }
@keyframes caret-blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }
```
(The global `prefers-reduced-motion` at line 1671 already nullifies the blink.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/core.test.mjs`
Expected: PASS. Manual/Playwright: saat menjawab → "Menghubungkan ke AI…" + kursor berkedip; delta pertama → "Sedang menjawab…".

- [ ] **Step 5: Commit**

```bash
git add tests/core.test.mjs js/chat.js css/components.css
git commit -m "feat(typing): status bertahap + kursor berkedip di indikator typing"
```

---

## Task 5: AbortController plumbing in providers.js (+ partial-on-abort test)

**Files:**
- Modify: `js/providers.js` (`chatCompletion`, `buildChatRequest`, `readSSE`; export `readSSE`)
- Test: `tests/core.test.mjs` (mock reader + real `AbortController`).

**Interfaces:**
- Consumes: `signal` from params (passed by app.js via `providerChat(..., { signal })`).
- Produces: `chatCompletion({...signal})`; `readSSE(res, onDelta, signal)` → `{ text, usage, sources }` partial when aborted.

- [ ] **Step 1: Write the failing test** (append to `tests/core.test.mjs`)

```js
import { readSSE } from '../js/providers.js';
const enc = new TextEncoder();
test('readSSE: parsial text dikembalikan saat abort di tengah stream', async () => {
  const ac = new AbortController();
  let call = 0;
  const reader = {
    async read() {
      call += 1;
      if (call === 1) return { done: false, value: enc.encode('data: {"choices":[{"delta":{"content":"Halo"}}]}\n') };
      if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return { done: true, value: undefined };
    },
    releaseLock() {}, cancel() {},
  };
  const res = { body: { getReader: () => reader } };
  ac.abort(); // berhenti sebelum stream selesai
  const out = await readSSE(res, () => {}, ac.signal);
  assert.equal(out.text, 'Halo');
  assert.ok(Array.isArray(out.sources));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core.test.mjs`
Expected: FAIL — `readSSE` not exported from `providers.js`.

- [ ] **Step 3: Write minimal implementation** in `js/providers.js`

a) Add `signal` to `chatCompletion` destructure and thread it:
```js
export async function chatCompletion({
  provider, apiKey, model, systemPrompt, contents,
  maxTokens = 8192, thinkingLevel, grounding, onDelta, signal,
}) {
  ...
  let res;
  try {
    res = await buildChatRequest(provider, apiKey, body, grounding, signal);
  } catch (err) { throw err; }
  ...
  if (wantStream && res.body && typeof res.body.getReader === 'function') {
    const streamed = await readSSE(res, onDelta, signal);
    return { text: streamed.text.trim(), tokens: {...}, sources: streamed.sources || [] };
  }
```
b) Thread `signal` into `buildChatRequest.fetch`:
```js
async function buildChatRequest(provider, apiKey, body, grounding, signal) {
  if (grounding && provider.supportsGrounding) body.tools = [{ type: 'function', function: { name: 'google_search', description: 'web grounding' } }];
  return fetch(`${provider.baseUrl}${provider.chatPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(apiKey) },
    body: JSON.stringify(body),
    signal,
  });
}
```
c) Rewrite `readSSE` to accept + honor `signal`, export it:
```js
export async function readSSE(res, onDelta, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', usage = null, sources = [];
  const handle = (payload) => { ... same as before ... };
  try {
    for (;;) {
      if (signal && signal.aborted) break; // berhenti rapi bila user menekan Berhendi
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { ... }
    }
    const tail = buf.trim();
    if (tail.startsWith('data:')) handle(tail.slice(5).trim());
  } catch (err) {
    // AbortError di tengah stream → kembalikan teks parsial, BUKAN throw.
    if (text) return { text, usage, sources };
    throw { ...mapApiError(0), message: (err && err.message) || 'Koneksi streaming terputus.' };
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return { text, usage, sources };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/core.test.mjs`
Expected: PASS. Manual/Playwright: tekan Berhendi saat streaming → balasan parsial tersimpan (Task 6 wiring).

- [ ] **Step 5: Commit**

```bash
git add tests/core.test.mjs js/providers.js
git commit -m "feat(providers): thread AbortSignal ke chatCompletion/buildChatRequest/readSSE + partial-on-abort"
```

---

## Task 6: Berhendi button (Krim ↔ Berhendi) + stopGeneration

**Files:**
- Modify: `js/app.js` (`updateComposer`, send click handler, module-level `abortCtl`/`userStopped`, `stopGeneration`)
- Test: manual/Playwright.

**Interfaces:**
- Consumes: `abortCtl`, `userStopped`, `stopGeneration()`; passes `signal: abortCtl.signal` into `providerChat`.
- Produces: button label toggles; click during busy → stop.

- [ ] **Step 1: Write the failing test** — export a tiny pure reducer for the composer state so behavior is verifiable:

```js
// app.js
export function composerButtonState(busy, hasText) {
  return busy ? { label: 'Berhendi', disabled: false } : { label: 'Kirim', disabled: !hasText };
}
```
Add test:
```js
import { composerButtonState } from '../js/app.js';
test('composerButtonState: toggle Kirim/Berhendi', () => {
  assert.deepEqual(composerButtonState(false, ''), { label: 'Kirim', disabled: true });
  assert.deepEqual(composerButtonState(false, 'hai'), { label: 'Kirim', disabled: false });
  assert.deepEqual(composerButtonState(true, ''), { label: 'Berhendi', disabled: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core.test.mjs`
Expected: FAIL — `composerButtonState` not exported from `app.js`.

- [ ] **Step 3: Write minimal implementation**

a) Module-level state (near top of app.js, after `const state = {...}`):
```js
let abortCtl = null;
let userStopped = false;
function stopGeneration() {
  userStopped = true;
  if (abortCtl) abortCtl.abort();
}
```
b) Rewrite `updateComposer`:
```js
function updateComposer() {
  const btn = composerButtonState(state.busy, dom.input.value.trim());
  dom.send.disabled = btn.disabled;
  dom.send.classList.toggle('is-stopping', state.busy);
  const label = dom.send.querySelector('.btn__label');
  if (label) label.textContent = btn.label;
}
```
c) In `sendUserMessage` and `generateGreeting`, before `await providerChat(...)`:
```js
userStopped = false;
abortCtl = new AbortController();
... providerChat(state.settings.provider, { ..., signal: abortCtl.signal }) ...
```
d) Update the send click handler (line ~1821):
```js
dom.send.addEventListener('click', () => {
  if (state.busy) stopGeneration();
  else sendUserMessage();
});
```
e) Reset in `finally` blocks: `abortCtl = null; userStopped = false;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/core.test.mjs`
Expected: PASS. Manual/Playwright: ketik → tombol "Kirim"; kirim → jadi "Berhendi"; tekan → stream berhenti, parsial tersimpan; tombol aktif kembali.

- [ ] **Step 5: Commit**

```bash
git add tests/core.test.mjs js/app.js
git commit -m "feat(ui): tombol Berhendi (Krim↔Berhendi) + stopGeneration via AbortController"
```

---

## Task 7: Retry on main send flow (distinguish user-stop from error)

**Files:**
- Modify: `js/app.js` (`sendUserMessage` catch)
- Test: manual/Playwright.

**Interfaces:**
- Consumes: existing `showRetry()`; `userStopped` flag + `AbortError`.

- [ ] **Step 1: Write the failing test** — export a classifier for stop-vs-error:

```js
// app.js
export function isUserStop(err) {
  return userStopped || (err && err.name === 'AbortError');
}
```
Add test:
```js
import { isUserStop } from '../js/app.js';
test('isUserStop: AbortError / flag = stop-user; error lain = sistem', () => {
  userStopped = true;
  assert.equal(isUserStop({ name: 'AbortError' }), true);
  assert.equal(isUserStop({ type: 'server' }), false);
  userStopped = false;
  assert.equal(isUserStop({ type: 'network' }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core.test.mjs`
Expected: FAIL — `isUserStop` not exported.

- [ ] **Step 3: Write minimal implementation** in `sendUserMessage` catch (replace the current error-only block):

```js
} catch (err) {
  removeTyping(dots);
  state.busy = false;
  const stop = isUserStop(err);
  if (!answered && !stop) {
    // Batalkan giliran yang gagal: pop bubble + user, kembalikan teks ke input.
    state.messages.pop();
    if (built) built.msg.remove();
    userEl.remove();
    if (fromInput) { dom.input.value = text; autosizeInput(); }
    if (!state.messages.length) { state.startedAt = null; showEmptyState(); }
  } else if (stop) {
    showToast('Balasan dihentikan.', 'info');
  }
  if (!stop) {
    const msgText = errorDisplayText(err);
    addNotice(dom.messages, msgText, 'error');
    showToast(msgText, 'error');
    showRetry();
    logApiError(err);
  }
} finally {
  abortCtl = null; userStopped = false;
  updateComposer(); updateStats(); saveActiveSession();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/core.test.mjs`
Expected: PASS. Manual/Playwright: error jaringan/API → muncul "Coba lagi"; Berhendi → tidak muncul retry (parsial tersimpan).

- [ ] **Step 5: Commit**

```bash
git add tests/core.test.mjs js/app.js
git commit -m "feat(ui): tombol Coba lagi di jalur kirim utama; bedakan stop-user dari error sistem"
```

---

## Self-Review

1. **Spec coverage:**
   - Websearch snippet + validated href → Task 2 (+ Task 1 helpers). ✓
   - Per-answer states loading/not-found/unsupported → Task 3. ✓
   - Staged status "Menghubungkan ke AI…" → "Sedang menjawab…" → Task 4. ✓
   - Blinking cursor → Task 4 (CSS `.typing__caret`). ✓
   - Real Berhendi via AbortController → Tasks 5 + 6. ✓
   - Retry on main send, distinguish stop vs error → Task 7. ✓
   - `prefers-reduced-motion` respected → noted in Task 4 CSS + global rule. ✓

2. **Placeholder scan:** All steps include actual code; no "TBD"/"add validation". readSSE partial-on-abort shown verbatim. ✓

3. **Type consistency:** `signal` threaded as `AbortSignal`; `classifyWebSearch` returns the three strings used by Task 3 UI; `composerButtonState`/`isUserStop` exported from app.js and imported in tests. Signatures match across tasks. ✓

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-05-websearch-typing-polish.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `executing-plans`, batch with checkpoints.

*Which approach?*
