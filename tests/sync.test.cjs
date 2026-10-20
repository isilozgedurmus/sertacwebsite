const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = ['../dist/sync.js', '../web/sync.js'].map(file => path.join(__dirname, file)).find(file => fs.existsSync(file));
const context = { module: { exports: {} }, setTimeout, clearTimeout, AbortController };
require('node:vm').runInNewContext(fs.readFileSync(source, 'utf8'), context);
const { create, mergeNotebooks, normalizeNotebook, stampChanges, stable } = context.module.exports;
const clone = value => JSON.parse(JSON.stringify(value));
const empty = () => ({ demo: false, words: [], passages: [], sessions: [], notes: {} });
const word = (text, tr, time = 100) => ({ id: 'id-' + text, word: text, tr, date: '2026-10-20', _updatedAt: time, _updatedBy: 'device' });
function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), values };
}
function server(initial = null) {
  return {
    notebook: clone(initial), revision: initial ? 1 : 0, calls: [], user: { id: 'owner-1', email: 'test@example.invalid' }, beforePut: null,
    async fetch(url, init) {
      this.calls.push(init.method);
      assert.equal(url, '/api/sync');
      assert.equal(init.credentials, 'same-origin');
      const response = status => ({ ok: status >= 200 && status < 300, status, json: async () => ({ revision: this.revision, notebook: clone(this.notebook), user: this.user }) });
      if (init.method === 'GET') return response(200);
      assert.equal(init.headers['Content-Type'], 'application/json');
      if (this.beforePut) await this.beforePut();
      const body = JSON.parse(init.body);
      if (body.baseRevision !== this.revision) return response(409);
      this.notebook = clone(body.notebook); this.revision++;
      return response(200);
    },
  };
}
function client(initial, cloud, extras = {}) {
  let notebook = clone(initial);
  let clock = 2000000000000;
  const store = extras.storage || storage();
  const client = create({
    getNotebook: () => notebook, setNotebook: value => { notebook = value; },
    onStatus: () => {}, storage: store, fetch: cloud.fetch.bind(cloud),
    now: () => ++clock, pollInterval: 0, debounce: 100000, BroadcastChannel: null,
    eventTarget: null, document: null, navigator: { onLine: true }, ...extras,
  });
  return { client, storage: store, get notebook() { return notebook; }, set notebook(value) { notebook = value; } };
}
async function main() {
  const a = { ...empty(), words: [word('adapt', 'uyum sağlamak', 10)] };
  const b = { ...empty(), words: [word('thrive', 'gelişmek', 20)] };
  const joined = mergeNotebooks(a, b);
  assert.equal(joined.words.length, 2);
  assert.equal(stable(joined), stable(mergeNotebooks(b, a)), 'Merge must commute.');
  assert.equal(stable(joined), stable(mergeNotebooks(joined, joined)), 'Merge must be idempotent.');

  const newEdit = { ...a, words: [{ ...a.words[0], tr: 'yeni anlam', _updatedAt: 80, _updatedBy: 'phone' }] };
  assert.equal(mergeNotebooks(a, newEdit).words[0].tr, 'yeni anlam');
  assert.equal(mergeNotebooks(newEdit, a).words[0].tr, 'yeni anlam', 'A stale device cannot overwrite the edit.');
  const duplicate = { ...empty(), words: [{ ...word('  ADAPT ', 'other', 15), id: 'other-device-id' }] };
  assert.equal(mergeNotebooks(a, duplicate).words.length, 1, 'Words are deduplicated independently of local IDs.');
  const renamed = { ...a, words: [{ ...a.words[0], word: 'adopt', tr: 'benimsemek', _updatedAt: 90, _updatedBy: 'phone' }] };
  const renameMerge = mergeNotebooks(renamed, a);
  assert.equal(renameMerge.words.length, 1, 'Same-ID spelling edits must not resurrect the old spelling.');
  assert.equal(renameMerge.words[0].word, 'adopt');
  assert.equal(stable(renameMerge), stable(mergeNotebooks(a, renamed)));
  const legacyAscii = { ...a.words[0], tr: 'zz', _updatedAt: 100, _updatedBy: '' };
  const legacyEmoji = { ...legacyAscii, tr: '💡' };
  assert.equal(stable({ tr: '💡', 'ç': 'ı' }), '{"tr":"\\ud83d\\udca1","\\u00e7":"\\u0131"}');
  assert.equal(/[^\x00-\x7f]/.test(stable({ tr: '💡', 'ç': 'ı' })), false, 'Canonical JSON is ASCII for both strings and keys.');
  const unicodeTie = mergeNotebooks({ ...empty(), words: [legacyAscii] }, { ...empty(), words: [legacyEmoji] });
  assert.equal(unicodeTie.words[0].tr, '💡', 'Legacy completeness uses the escaped canonical length, matching SQLite.');
  assert.equal(stable(unicodeTie), stable(mergeNotebooks({ ...empty(), words: [legacyEmoji] }, { ...empty(), words: [legacyAscii] })));

  const passages = { ...empty(), passages: [{ date: '2026-10-20', type: 'daily', title: 'New', text: 'new text', _updatedAt: 300 }], sessions: [{ date: '2026-10-20', type: 'daily', correct: 4, total: 6, _updatedAt: 310 }], notes: { '2026-10-20': 'new drawing' }, _noteModified: { '2026-10-20': { updatedAt: 300, updatedBy: 'tablet' } } };
  const older = { ...empty(), passages: [{ date: '2026-10-20', type: 'daily', title: 'Old', text: 'old text', _updatedAt: 30 }], sessions: [{ date: '2026-10-20', type: 'daily', correct: 1, total: 6, _updatedAt: 31 }], notes: { '2026-10-20': 'old drawing' }, _noteModified: { '2026-10-20': { updatedAt: 30, updatedBy: 'phone' } } };
  const study = mergeNotebooks(older, passages);
  assert.equal(study.passages[0].title, 'New'); assert.equal(study.sessions[0].correct, 4); assert.equal(study.notes['2026-10-20'], 'new drawing');

  const initial = { ...empty(), words: [{ id: 'legacy', word: 'adapt', tr: 'eski anlam', date: '2026-10-19' }] };
  const initialized = stampChanges(initial, initial, 'desktop', 2000000000000);
  assert.equal(initialized.words[0]._updatedAt, Date.parse('2026-10-19T00:00:00Z'), 'Unchanged legacy records retain their historical date.');
  const edited = stampChanges(initialized, { ...initialized, words: [{ ...initialized.words[0], tr: 'düzenlendi' }] }, 'desktop', 2000000000000);
  assert.equal(edited.words[0]._updatedAt, 2000000000000);
  assert.equal(stampChanges(edited, edited, 'desktop', 2000000000200).words[0]._updatedAt, 2000000000000, 'Read/poll must not restamp records.');
  assert.equal(mergeNotebooks(initial, edited).words[0].tr, 'düzenlendi');
  assert.equal(normalizeNotebook({ demo: true, words: [word('fake', 'örnek')] }).words.length, 0);

  const cloud = server();
  const phone = client(a, cloud);
  await phone.client.start();
  assert.equal(phone.client.getStatus().state, 'synced');
  assert.ok(phone.storage.getItem('kelime-sync-migration-backup-v1'), 'First upload keeps a local migration backup.');
  const tablet = client(b, cloud);
  await tablet.client.start(); await phone.client.syncNow();
  assert.equal(phone.notebook.words.length, 2); assert.equal(tablet.notebook.words.length, 2); assert.equal(cloud.notebook.words.length, 2);
  phone.client.dispose(); tablet.client.dispose();

  const demoCloud = server();
  const demoClient = client({ demo: true, words: [word('fake', 'örnek')], passages: [], sessions: [], notes: {} }, demoCloud);
  await demoClient.client.start();
  assert.equal(demoCloud.calls.filter(method => method === 'PUT').length, 0, 'Demo content is never uploaded.');
  assert.equal(demoClient.notebook.demo, true); assert.equal(demoClient.client.getStatus().state, 'ready');
  demoClient.client.dispose();
  const existingCloud = server(a);
  const newDevice = client({ demo: true, words: [], passages: [], sessions: [], notes: {} }, existingCloud);
  await newDevice.client.start();
  assert.equal(newDevice.notebook.demo, false); assert.equal(newDevice.notebook.words[0].word, 'adapt');
  newDevice.client.dispose();

  const racingCloud = server(a);
  let raced = false;
  racingCloud.beforePut = () => {
    if (raced) return;
    raced = true;
    racingCloud.notebook = mergeNotebooks(racingCloud.notebook, { ...empty(), words: [word('garden', 'bahçe', 60)] });
    racingCloud.revision++;
  };
  const racingClient = client(b, racingCloud);
  await racingClient.client.start();
  assert.equal(racingCloud.notebook.words.length, 3, 'CAS collision retries merge both devices.');
  assert.ok(racingCloud.calls.filter(method => method === 'PUT').length >= 2);
  racingClient.client.dispose();

  const movingCloud = server(empty());
  const movingClient = client(empty(), movingCloud);
  await movingClient.client.start();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const didEnter = new Promise(resolve => { entered = resolve; });
  let paused = false;
  movingCloud.beforePut = async () => { if (paused) return; paused = true; entered(); await gate; };
  movingClient.notebook.words.push(word('first', 'birinci')); movingClient.client.changed();
  const saving = movingClient.client.syncNow();
  await didEnter;
  movingClient.notebook.words.push(word('second', 'ikinci')); movingClient.client.changed();
  release(); await saving;
  assert.equal(movingCloud.notebook.words.length, 2, 'An edit made while PUT is pending must also reach the cloud.');
  assert.equal(movingClient.notebook.words.length, 2); movingClient.client.dispose();

  const accountCloud = server({ ...empty(), words: [word('private-other', 'başka hesap')] });
  accountCloud.user = { id: 'new-owner' };
  const accountStore = storage({ 'kelime-sync-owner-v1': 'old-owner' });
  const isolated = client(a, accountCloud, { storage: accountStore });
  await isolated.client.start();
  assert.equal(isolated.client.getStatus().state, 'account-mismatch');
  assert.equal(accountCloud.calls.includes('PUT'), false, 'Never upload a previous account’s data to a new account.');
  assert.equal(isolated.notebook.words[0].word, 'adapt', 'Do not merge the other account’s private notebook.');
  isolated.client.dispose();

  const disconnected = { onLine: false }, offlineCloud = server();
  const offline = client(empty(), offlineCloud, { navigator: disconnected });
  await offline.client.start(); offline.notebook.words.push(word('offline', 'çevrim dışı')); offline.client.changed();
  await offline.client.syncNow(); assert.equal(offlineCloud.calls.length, 0); assert.equal(offline.client.getStatus().state, 'offline');
  disconnected.onLine = true; await offline.client.syncNow();
  assert.equal(offlineCloud.notebook.words[0].word, 'offline'); offline.client.dispose();

  for (const [statusCode, expected] of [[401, 'login-required'], [404, 'local']]) {
    const test = client(a, cloud, { fetch: async () => ({ ok: false, status: statusCode }) });
    await test.client.start(); assert.equal(test.client.getStatus().state, expected); test.client.dispose();
  }
  console.log('PASS: deterministic merge, stale edit protection, duplicate words, study data, legacy timestamps, cloud migration backup, two-device union, demo protection, CAS collision retry, edits during requests, account isolation, offline recovery and auth/local states.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
