// =========================================================
// BimbingKamu — ADAPTER PROVIDER
// Sumber kebenaran adapter per provider. Murni (tanpa fetch/DOM) agar tidak
// terjadi circular dependency dengan providers.js. Setiap *kind* transport
// mendefinisikan cara otentikasi, path discovery, body chat, streaming, dan
// normalisasi respons. providers.js menjadi "adapter-aware": dispatch ke
// adapter berdasarkan provider.kind ('oi' | 'anthropic').
//
// kind:
//   'oi'        = OpenAI-compatible (path generik /chat/completions). Dipakai
//                 OpenRouter, Gemini AI Studio, OpenAI, Groq, dan
//                 Custom-OI (default untuk provider custom user).
//   'anthropic' = Claude native (/v1/messages, auth x-api-key +
//                 anthropic-version, streaming content_block_delta,
//                 normalisasi content[]). BUKAN lewat OpenRouter.
// =========================================================

// ===== TEMPLATE TRANSPORT PER KIND =====
export const ADAPTERS = {
  oi: {
    kind: 'oi',
    name: 'OpenAI-Compatible',
    defaultBaseUrl: '',
    modelsPath: '/models',
    chatPath: '/chat/completions',
    supportsGrounding: true, // websearch → tools pencarian (semua provider bisa)
    supportsThinking: true,
    contextStrategy: 'probe', // 'probe' → cek /api/v0/models; 'none' → lewati
    // Kunci kosong → TANPA header auth (endpoint lokal tak butuh). Terisi → Bearer.
    authHeaders(apiKey) {
      return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    },
  },
  anthropic: {
    kind: 'anthropic',
    name: 'Claude (Anthropic)',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    modelsPath: '/models',
    chatPath: '/messages',
    supportsGrounding: true, // pencarian web lewat alat web_search (tool use native)
    supportsThinking: true,
    contextStrategy: 'probe',
    authHeaders(apiKey) { return anthropicAuthHeaders(apiKey); },
  },
};

// Ambil template adapter berdasarkan kind (default 'oi' bila tak dikenal).
export function getAdapter(kind) {
  return ADAPTERS[kind] || ADAPTERS.oi;
}

// Baca SATU chunk dari stream; tangkap abort dari signal pemanggil (tombol
// Berhenti) agar pembacaan TIDAK menggantung bila stream belum ditutup server,
// mis. saat idle antar-token. Bila signal null → reader.read() biasa. Dipakai
// readSSEAnthropic + readSSE agar jalur streaming responsif terhadap 'Berhenti'.
export async function readStreamChunk(reader, signal) {
  if (signal && signal.aborted) return { done: true };
  if (!signal) return reader.read();
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([
      reader.read(),
      new Promise((resolve) => ac.signal.addEventListener('abort', () => resolve({ done: true }), { once: true })),
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

// Header otentikasi per provider: dispatch ke adapter berdasarkan kind.
// Default 'oi' → Bearer; 'anthropic' → x-api-key + anthropic-version.
export function resolveAuthHeaders(provider, apiKey) {
  return getAdapter((provider && provider.kind) || 'oi').authHeaders(apiKey || '');
}

// ===== SPESIFIKATOR PROVIDER BAWAAN (sumber benarku DEFAULT_PROVIDERS) =====
// Masing-masing memperluas template adapter dengan baseUrl + kapabilitas khusus.
export const PROVIDER_DEFS = [
  { id: 'ep-openrouter', name: 'OpenRouter', kind: 'oi', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'ep-gemini', name: 'Gemini AI Studio', kind: 'oi', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'ep-openai', name: 'OpenAI', kind: 'oi', baseUrl: 'https://api.openai.com/v1' },
  { id: 'ep-groq', name: 'Groq', kind: 'oi', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'ep-anthropic', name: 'Claude (Anthropic)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
];

// Kembangkan PROVIDER_DEFS menjadi seed provider lengkap (shape yang sama dengan
// connectEndpoint): id + baseUrl wajib, modelsPath/chatPath, supportsGrounding/
// supportsThinking, contextStrategy, custom:false. Dipakai providers.js untuk
// menurunkan DEFAULT_PROVIDERS agar konfigurasi terpusat di sini.
export function buildProviderSeed(def) {
  const adapter = getAdapter(def.kind);
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    baseUrl: def.baseUrl || adapter.defaultBaseUrl || '',
    modelsPath: def.modelsPath || adapter.modelsPath,
    chatPath: def.chatPath || adapter.chatPath,
    supportsGrounding: def.supportsGrounding ?? adapter.supportsGrounding,
    supportsThinking: def.supportsThinking ?? adapter.supportsThinking,
    contextStrategy: def.contextStrategy || adapter.contextStrategy,
    custom: false,
  };
}

// ===== ANTHROPIC: OTENTIKASI =====
// Claude native memakai header x-api-key + anthropic-version (bukan Bearer).
export function anthropicAuthHeaders(apiKey) {
  return {
    'x-api-key': apiKey || '',
    'anthropic-version': '2023-06-01',
  };
}

// ===== ANTHROPIC: NORMALISASI ISI =====
// Respons Claude menyimpan isi di array content = [{ type:'text', text }].
// Ambil semua blok teks menjadi satu string.
export function normalizeAnthropicText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    if (block && block.type === 'text') out += block.text || '';
  }
  return out;
}

// ===== ANTHROPIC: STREAMING SSE =====
// Format streaming Claude (SSE):
//   message_start      → usage.input_tokens/output_tokens/total_tokens
//   content_block_start→ blok text / tool_use (id + name)
//   content_block_delta→ text_delta (teks) atau input_json_delta (argumen alat)
//   message_delta      → usage penutup
//   message_end        → usage lengkap
// Mengembalikan { text, usage, toolCalls }.
export async function readSSEAnthropic(res, onDelta, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', usage = null;
  const toolBlocks = new Map(); // index → { id, name, json }
  const handle = (payload) => {
    if (payload === '[DONE]') return;
    let ev; try { ev = JSON.parse(payload); } catch { return; } // baris rusak → lewati
    // usage Anthropic bisa di top-level (message_start) atau di dalam
    // message.usage (message_end). Ambil yang terakhir muncul → paling lengkap.
    const u = ev && (ev.usage || (ev.message && ev.message.usage));
    if (u) usage = u;
    // Blok alat: id + nama di content_block_start, argumen mengalir sebagai
    // potongan JSON di input_json_delta.
    const block = ev && ev.content_block;
    if (ev && ev.type === 'content_block_start' && block && block.type === 'tool_use') {
      toolBlocks.set(ev.index, { id: block.id || '', name: block.name || '', json: '' });
    }
    const delta = ev.delta;
    if (delta && delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
      text += delta.text;
      if (typeof onDelta === 'function') onDelta(text);
    }
    if (delta && delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const tool = toolBlocks.get(ev.index);
      if (tool) tool.json += delta.partial_json;
    }
  };
  try {
    for (;;) {
      const { done, value } = await readStreamChunk(reader, signal);
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith('data:')) handle(line.slice(5).trim());
      }
      // Berhenti setelah chunk ini diproses bila user sudah menekan Berhenti.
      if (signal && signal.aborted) break;
    }
    // Sisa buffer tanpa newline di akhir stream.
    const tail = buf.trim();
    if (tail.startsWith('data:')) handle(tail.slice(5).trim());
  } catch (err) {
    if (text) return { text, usage, sources: [], toolCalls: [] }; // stream putus → pakai yang sudah datang
    throw { type: 'network', message: 'Koneksi streaming Claude terputus.' };
  }
  const toolCalls = [...toolBlocks.values()]
    .filter((b) => b.name)
    .map((b) => {
      let input = {};
      try {
        input = b.json ? JSON.parse(b.json) : {};
      } catch {
        input = {};
      }
      return { id: b.id, name: b.name, input };
    });
  return { text, usage, sources: [], toolCalls };
}
