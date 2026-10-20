import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNotebookStore } from '../aws/notebook-store.mjs';
import { createLambdaHandler } from '../aws/handler.mjs';
let state = null, version = 0;
const store = createNotebookStore({
  async read() { return { state: state ? structuredClone(state) : null, etag: version ? String(version) : null }; },
  async write(next, etag) {
    if (etag !== (version ? String(version) : null)) throw { $metadata: { httpStatusCode: 412 } };
    state = structuredClone(next); version++;
  },
});
const password = 'test-only-long-password';
const auth = 'Basic ' + Buffer.from('owner:' + password).toString('base64');
const handler = createLambdaHandler({ store, credentials: async () => ({ username: 'owner', password }),
  publicOrigin: 'https://notebook.example', serve: async request => new Response(request.method === 'HEAD' ? null : '<h1>Notebook</h1>', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public' } }) });
const notebook = words => ({ demo: false, words, passages: [], sessions: [], notes: {} });
const word = (name, time) => ({ id: name, word: name, tr: 'anlam', date: '2026-10-20', _updatedAt: time, _updatedBy: 'device' });
const event = (method = 'GET', path = '/api/sync', body, headers = {}) => ({ rawPath: path, requestContext: { domainName: 'test.lambda-url.eu-central-1.on.aws', http: { method } }, headers: { authorization: auth, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
const parse = response => JSON.parse(response.body);
assert.equal((await handler({ ...event(), headers: { 'oai-authenticated-user-id': 'forged', host: 'spoof.example' } })).statusCode, 401);
assert.equal((await handler({ ...event('GET', '/'), headers: {} })).statusCode, 401, 'HTML is private, too.');
assert.equal((await handler(event('GET', '/health', null, { authorization: '' }))).statusCode, 200);
assert.equal((await handler(event('GET', '/'))).headers['Cache-Control'], 'no-store, private');
assert.equal((await handler(event('HEAD', '/'))).body, '');
assert.equal(parse(await handler(event())).notebook, null);
const save = (revision, words, headers = {}) => handler(event('PUT', '/api/sync', { baseRevision: revision, notebook: notebook(words) }, { 'content-type': 'application/json', origin: 'https://notebook.example', ...headers }));
assert.equal((await save(0, [word('reach', 1)])).statusCode, 200);
assert.equal((await save(0, [word('strive', 1)])).statusCode, 409);
assert.equal(parse(await save(1, [])).notebook.words.length, 1, 'Blank device never clears stored words.');
const races = await Promise.all([save(2, [word('adapt', 2)]), save(2, [word('thrive', 2)])]);
assert.deepEqual(races.map(r => r.statusCode).sort(), [200, 409], 'One conditional S3 write wins, the other returns the current notebook.');
assert.equal(parse(await handler(event())).notebook.words.length, 2);
assert.equal((await save(3, [], { origin: 'https://evil.example' })).statusCode, 403);
assert.equal((await save(3, [], { 'sec-fetch-site': 'cross-site' })).statusCode, 403);
assert.equal((await save(3, [], { 'content-type': 'text/plain' })).statusCode, 415);
const invalid = event('PUT', '/api/sync', { baseRevision: 3, notebook: { demo: true } }, { 'content-type': 'application/json' });
assert.equal((await handler(invalid)).statusCode, 400);
assert.equal((await handler(event('DELETE'))).statusCode, 405);
const failing = createLambdaHandler({ store, credentials: async () => { throw Error('secret-value-or-private-diagnostics'); } });
const failed = await failing(event()); assert.equal(failed.statusCode, 503); assert.ok(!failed.body.includes('secret-value'));
const isolated = await mkdtemp(join(tmpdir(), 'kelime-lambda-test-'));
try {
  await cp(new URL('../.aws-build/', import.meta.url), isolated, { recursive: true });
  const { handler: packaged } = await import(pathToFileURL(join(isolated, 'index.mjs')));
  assert.equal((await packaged({ ...event('GET', '/health'), headers: {} })).statusCode, 200, 'Packaged Lambda runs outside the repository with its own locked SDKs.');
} finally { await rm(isolated, { recursive: true, force: true }); }
console.log('PASS: Lambda authentication, spoof protection, private assets, conditional writes, concurrent devices, CAS conflicts, stale/blank protection, CSRF, validation and packaged runtime.');
