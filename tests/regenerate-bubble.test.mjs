// Jalankan: node --test tests/regenerate-bubble.test.mjs
// Reproduksi urutan DOM dari regenerateLast() + rerenderModelMessage() di app.js
// (verbatim) lewat chat.js + redo.js asli, lalu cek: apakah ada bubble model KOSONG
// tersisa setelah regenerasi? (Bug #1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM();
globalThis.window = window;
globalThis.document = window.document;

import {
  showTyping, removeTyping, addModelMessage, addUserMessage, renderRich,
} from '../js/chat.js';
import { planRedo, applyRedo } from '../js/redo.js';

// --- Sarena mini: dom.messages + state.messages (mirip app.js) ---
function makeEnv() {
  const messages = document.createElement('div');
  document.body.appendChild(messages);
  return {
    messages,
    state: { busy: false, messages: [] },
  };
}

// Kopya verbatim rerenderModelMessage(idx) dari app.js (tanpa stamp/actions —
// keduanya tak menambah .msg--model baru, jadi aman diabaikan untuk cek kekosongan).
function rerenderModelMessage(dom, state, idx) {
  const bubbles = dom.messages.querySelectorAll('.msg--model');
  if (bubbles.length) bubbles[bubbles.length - 1].remove();
  const msg = state.messages[idx];
  if (!msg) return;
  const built = addModelMessage(dom.messages);
  renderRich(built.content, msg.text || '');
}

// Replica regenerateLast() dari app.js; providerReply mock async.
async function regenerateLast(dom, state, providerReply) {
  const plan = applyRedo(state.messages, planRedo(state.messages));
  if (!plan) return null;
  state.busy = true;
  const typing = showTyping(dom.messages);
  try {
    const reply = await providerReply();
    removeTyping(typing);
    const prev = state.messages[plan.modelIndex];
    state.messages[plan.modelIndex] = { ...prev, text: reply, sources: [], tokens: 0 };
    rerenderModelMessage(dom, state, plan.modelIndex);
    state.busy = false;
  } catch (err) {
    removeTyping(typing);
    state.busy = false;
  } finally {
    // updateComposer / saveActiveSession — diabaikan.
  }
  return plan;
}

// Bubble model "kosong" = .msg--model bukan typing, dan bubble-nya tak punya teks.
function emptyModelBubbles(container) {
  return Array.from(container.querySelectorAll('.msg--model')).filter((m) => {
    const isTyping = m.dataset.typing === 'true';
    const bubble = m.querySelector('.msg__bubble');
    const hasText = Boolean(bubble) && bubble.textContent.trim().length > 0;
    return !isTyping && !hasText;
  });
}

function seed(dom, state, pairs) {
  // pairs: [[Q, A], ...] → [user, model, user, model, ...]
  state.messages = [];
  for (const [q, a] of pairs) {
    state.messages.push({ role: 'user', text: q });
    state.messages.push({ role: 'model', text: a });
  }
  renderInitial(dom, state); // tiru renderMessagesFromState (tanpa actions)
}

// Render seluruh state ke DOM agar regenerasi bekerja pada chat yang sudah utuh.
function renderInitial(dom, state) {
  dom.messages.innerHTML = '';
  for (let i = 0; i < state.messages.length; i++) {
    const m = state.messages[i];
    if (m.hidden) continue;
    if (m.role === 'user') addUserMessage(dom.messages, m.text);
    else if (m.role === 'model') {
      const built = addModelMessage(dom.messages);
      renderRich(built.content, m.text || '');
    }
  }
}

test('regenerateLast: single-turn tidak menyisa bubble kosong', async () => {
  const dom = makeEnv();
  const state = dom.state;
  seed(dom, state, [['Q1', 'A1']]);
  await regenerateLast(dom, state, async () => 'A1-baru');

  const empties = emptyModelBubbles(dom.messages);
  assert.equal(empties.length, 0, 'harus tanpa bubble kosong');
  // Hanya 1 model bubble (A1 lama diganti), berisi teks baru.
  const models = dom.messages.querySelectorAll('.msg--model');
  assert.equal(models.length, 1);
  assert.match(dom.messages.querySelector('.msg--model .msg__bubble').textContent, /A1-baru/);
  // Tidak ada typing tersisa.
  assert.equal(dom.messages.querySelectorAll('[data-typing="true"]').length, 0);
});

test('regenerateLast: multi-turn (Q1,A1,Q2,A2) → regen A2 tidak menyisa bubble kosong', async () => {
  const dom = makeEnv();
  const state = dom.state;
  seed(dom, state, [['Q1', 'A1'], ['Q2', 'A2']]);
  await regenerateLast(dom, state, async () => 'A2-baru');

  assert.equal(emptyModelBubbles(dom.messages).length, 0, 'harus tanpa bubble kosong');
  // Total: 2 user + 2 model (A1 tetap, A2 → A2-baru).
  assert.equal(dom.messages.querySelectorAll('.msg--user').length, 2);
  assert.equal(dom.messages.querySelectorAll('.msg--model').length, 2);
  const lastModel = dom.messages.querySelectorAll('.msg--model')[1];
  assert.match(lastModel.querySelector('.msg__bubble').textContent, /A2-baru/);
});

test('regenerateLast: gagal (providerChat throw) tidak menyisa bubble typing kosong', async () => {
  const dom = makeEnv();
  const state = dom.state;
  seed(dom, state, [['Q1', 'A1']]);
  await regenerateLast(dom, state, async () => { throw new Error('network'); });

  assert.equal(dom.messages.querySelectorAll('[data-typing="true"]').length, 0, 'typing harus hilang');
  // Bubble A1 lama tetap utuh (tidak dihapus saat gagal).
  const models = dom.messages.querySelectorAll('.msg--model');
  assert.equal(models.length, 1);
});
