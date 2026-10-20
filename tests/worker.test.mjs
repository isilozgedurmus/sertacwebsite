import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHandler } from '../worker/index.js';

const sqlite = new DatabaseSync(':memory:');
for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
  sqlite.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
}
const DB = {
  prepare(sql) { return { sql, args: [], bind(...args) { return { sql, args }; } }; },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const result = statements.map(({ sql, args }) => {
        const query = sqlite.prepare(sql);
        if (/^\s*SELECT/i.test(sql)) return { results: query.all(...args), meta: { changes: 0 } };
        const meta = query.run(...args); return { results: [], meta: { changes: Number(meta.changes) } };
      });
      sqlite.exec('COMMIT'); return result;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const handler = createHandler({ '/index.html': { type: 'text/html', body: '<h1>Kelime</h1>' } });
const empty = () => ({ demo: false, words: [], passages: [], sessions: [], notes: {} });
const word = (name, time = 1, by = 'device-a') => ({ id: name + '-id', word: name, tr: name + '-tr', date: '2026-10-20', _updatedAt: time, _updatedBy: by });
async function request(user, method = 'GET', value, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (user) headers['oai-authenticated-user-id'] = user;
  if (value !== undefined) headers['content-type'] = 'application/json';
  return handler(new Request('https://kelime.test/api/sync', { method, headers, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }), { DB });
}

assert.equal((await request(null)).status, 401, 'Identity is mandatory.');
assert.equal((await request('a', 'DELETE')).status, 405);
assert.equal((await request('a', 'PUT', { baseRevision: 0, notebook: empty() }, { origin: 'https://other.test' })).status, 403);
assert.equal((await request('a', 'PUT', { baseRevision: 0, notebook: { ...empty(), demo: true } })).status, 400);
assert.equal((await request('a', 'PUT', { baseRevision: -1, notebook: empty() })).status, 400);
assert.equal((await (await request('a')).json()).notebook, null);

const first = { ...empty(), words: [word('adapt')] };
const saved = await request('a', 'PUT', { baseRevision: 0, notebook: first });
assert.equal(saved.status, 200); assert.equal((await saved.json()).revision, 1);
assert.equal((await (await request('b')).json()).notebook, null, 'Another account cannot see this notebook.');
const stale = await request('a', 'PUT', { baseRevision: 0, notebook: { ...empty(), words: [word('benefit')] } });
assert.equal(stale.status, 409); assert.equal((await stale.json()).notebook.words[0].word, 'adapt');
assert.equal((await (await request('a')).json()).notebook.words.length, 1, 'Conflicting write made no partial row changes.');

const newer = { ...empty(), words: [word('adapt', 3), word('benefit', 2)] };
assert.equal((await request('a', 'PUT', { baseRevision: 1, notebook: newer })).status, 200);
const blank = await request('a', 'PUT', { baseRevision: 2, notebook: empty() });
assert.equal(blank.status, 200);
assert.equal((await blank.json()).notebook.words.length, 2, 'An empty device must not erase existing records.');
const oldContent = await request('a', 'PUT', { baseRevision: 3, notebook: first });
assert.equal(oldContent.status, 200);
assert.equal((await oldContent.json()).notebook.words.find(word => word.word === 'adapt')._updatedAt, 3, 'Old record cannot replace newer data.');

const two = await Promise.all([
  request('a', 'PUT', { baseRevision: 4, notebook: { ...empty(), words: [word('thrive', 5)] } }),
  request('a', 'PUT', { baseRevision: 4, notebook: { ...empty(), words: [word('resilient', 6)] } }),
]);
assert.deepEqual(two.map(response => response.status).sort(), [200, 409]);
const current = await (await request('a')).json();
assert.equal(current.notebook.words.filter(word => ['thrive', 'resilient'].includes(word.word)).length, 1, 'Only one racing request writes records.');
const validNote = { ...empty(), notes: { '2026-10-20': 'data:image/png;base64,YQ==' }, _noteModified: { '2026-10-20': { updatedAt: 9, updatedBy: 'pen' } } };
assert.equal((await request('a', 'PUT', { baseRevision: current.revision, notebook: validNote })).status, 200);
assert.equal((await (await request('a')).json()).notebook._noteModified['2026-10-20'].updatedAt, 9);

const staticResponse = await handler(new Request('https://kelime.test/'), { DB });
assert.equal(staticResponse.status, 200); assert.match(await staticResponse.text(), /Kelime/);
assert.equal((await handler(new Request('https://kelime.test/', { method: 'HEAD' }), { DB })).body, null);
assert.equal((await handler(new Request('https://kelime.test/.env'), { DB })).status, 404);
assert.equal((await handler(new Request('https://kelime.test/api/sync', { headers: { 'oai-authenticated-user-id': 'a' } }), {})).status, 503);
await import('../web/sync.js');
const legacyA = { ...word('legacy', 0, ''), tr: 'zz' };
const legacyB = { ...word('legacy', 0, ''), tr: '💡' };
const merged = globalThis.KelimeSync.mergeNotebooks({ ...empty(), words: [legacyA] }, { ...empty(), words: [legacyB] });
await request('unicode', 'PUT', { baseRevision: 0, notebook: { ...empty(), words: [legacyA] } });
const unicode = await request('unicode', 'PUT', { baseRevision: 1, notebook: merged });
assert.equal((await unicode.json()).notebook.words[0].tr, merged.words[0].tr, 'Client and SQLite agree on Unicode legacy ties.');
const renamed = { ...word('renamed', 9), id: 'adapt-id' };
const renameState = await (await request('a')).json();
await request('a', 'PUT', { baseRevision: renameState.revision, notebook: { ...empty(), words: [renamed] } });
const renamedResult = await (await request('a')).json();
assert.equal(renamedResult.notebook.words.find(record => record.id === 'adapt-id').word, 'renamed');
console.log('PASS: migrated SQLite schema, account isolation, identity/CSRF, CAS conflict atomicity, merge-safe empty writes, stale-record protection, notes, assets.');
