import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('manifest: field wajib + tema + ikon lengkap', () => {
  const m = JSON.parse(readFileSync('./manifest.json', 'utf8'));
  assert.equal(m.name, 'TanyaBukan — Tutor Socratic');
  assert.equal(m.short_name, 'TanyaBukan');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.theme_color, '#4F46E5');
  assert.equal(m.background_color, '#FAFAFA');
  const sizes = m.icons.map((i) => i.sizes);
  for (const s of ['192x192', '512x512', '1024x1024']) {
    assert.ok(sizes.includes(s), `harus ada ikon ${s}`);
  }
});
