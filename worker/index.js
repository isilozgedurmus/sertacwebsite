// The build embeds the frontend assets here. Identity is provided by Sites dispatch.
const ASSETS = Object.freeze({});
const MAX_BODY = 8 * 1024 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const normalizeWord = word => String(word || '').trim().replace(/\s+/g, ' ').toLowerCase();
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length <= max;
const literal = value => JSON.stringify(value)?.replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => literal(key) + ':' + stable(value[key])).join(',') + '}' : literal(value);

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff',
  } });
}

function getUser(request) {
  const id = request.headers.get('oai-authenticated-user-id');
  if (!id || id.length > 512 || /[\r\n\0]/.test(id)) return null;
  return { id, email: request.headers.get('oai-authenticated-user-email') || '' };
}

function modification(record) {
  return {
    at: Number.isSafeInteger(record?._updatedAt) && record._updatedAt >= 0 ? record._updatedAt : 0,
    by: text(record?._updatedBy, 128) ? record._updatedBy : '',
  };
}

export function validateNotebook(notebook) {
  if (!object(notebook) || notebook.demo !== false) throw Error('Yalnızca kişisel defter eşitlenebilir.');
  if (!Array.isArray(notebook.words) || !Array.isArray(notebook.passages) || !Array.isArray(notebook.sessions) || !object(notebook.notes)) throw Error('Defter biçimi geçersiz.');
  if (notebook.words.length > 20000 || notebook.passages.length > 5000 || notebook.sessions.length > 15000 || Object.keys(notebook.notes).length > 5000) throw Error('Defter bu eşitleme için çok büyük.');
  const records = [];
  const add = (kind, key, value, meta = modification(value)) => {
    const payload = stable(value);
    if (new TextEncoder().encode(payload).byteLength > 700000) throw Error('Bir kayıt eşitleme sınırını aşıyor.');
    records.push({ kind, key, payload, at: meta.at, by: meta.by });
  };
  for (const word of notebook.words) {
    if (!object(word) || !text(word.id, 128) || !word.id || !text(word.word, 80) || !/^[a-z]+(?:[ '\u2019-][a-z]+)*$/i.test(word.word.trim()) || !text(word.tr, 500) || !DATE.test(word.date)) throw Error('Kelime kaydı geçersiz.');
    for (const field of ['synonym', 'antonym', 'type', 'example', 'definition']) if (word[field] != null && !text(word[field], 10000)) throw Error('Kelime bilgisi geçersiz.');
    add('word', word.id, word);
  }
  for (const passage of notebook.passages) {
    if (!object(passage) || !DATE.test(passage.date) || !['daily', 'all'].includes(passage.type) || !text(passage.title, 1000) || !text(passage.text, 250000) || !Array.isArray(passage.questions) || passage.questions.length > 100) throw Error('Pasaj kaydı geçersiz.');
    for (const question of passage.questions) {
      if (!object(question) || !['multiple', 'tfng', 'gap'].includes(question.kind) || !text(question.prompt, 10000) || !text(question.answer, 5000) || !text(question.explanation, 10000)) throw Error('Soru kaydı geçersiz.');
      if (question.kind !== 'gap' && (!Array.isArray(question.options) || question.options.length > 20 || !question.options.every(option => text(option, 5000)) || !question.options.includes(question.answer))) throw Error('Soru seçenekleri geçersiz.');
    }
    add('passage', passage.date + ':' + passage.type, passage);
  }
  for (const session of notebook.sessions) {
    if (!object(session) || !DATE.test(session.date) || !['daily', 'all'].includes(session.type) || !Number.isInteger(session.correct) || !Number.isInteger(session.total) || session.correct < 0 || session.total < session.correct || session.total > 1000) throw Error('Çalışma sonucu geçersiz.');
    add('session', session.date + ':' + session.type, session);
  }
  for (const [date, note] of Object.entries(notebook.notes)) {
    if (!DATE.test(date) || !text(note, 650000) || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(note)) throw Error('Kalem notu geçersiz.');
    const meta = notebook._noteModified?.[date];
    add('note', date, { data: note, modified: meta || { updatedAt: 0, updatedBy: '' } }, {
      at: Number.isSafeInteger(meta?.updatedAt) && meta.updatedAt >= 0 ? meta.updatedAt : 0,
      by: text(meta?.updatedBy, 128) ? meta.updatedBy : '',
    });
  }
  return records;
}

async function readNotebook(db, user) {
  const [meta, rows] = await db.batch([
    db.prepare('SELECT revision, updated_at FROM notebooks WHERE user_id = ?').bind(user.id),
    db.prepare('SELECT kind, record_key, payload FROM notebook_records WHERE user_id = ? ORDER BY kind, record_key').bind(user.id),
  ]);
  const metadata = meta.results[0];
  if (!metadata) return { revision: 0, notebook: null, user };
  const notebook = { demo: false, words: [], passages: [], sessions: [], notes: {}, _noteModified: {} };
  const arrays = { word: 'words', passage: 'passages', session: 'sessions' };
  for (const row of rows.results) {
    const payload = JSON.parse(row.payload);
    if (arrays[row.kind]) notebook[arrays[row.kind]].push(payload);
    else if (row.kind === 'note') { notebook.notes[row.record_key] = payload.data; notebook._noteModified[row.record_key] = payload.modified; }
  }
  return { revision: metadata.revision, notebook, user, updatedAt: metadata.updated_at };
}

async function readBody(request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) throw Error('BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw Error('Geçersiz istek.');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw Error('BODY_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function saveNotebook(db, user, revision, records) {
  const token = crypto.randomUUID();
  const statements = [
    db.prepare('INSERT INTO notebooks (user_id, revision, write_token, updated_at) VALUES (?, 0, ?, 0) ON CONFLICT(user_id) DO NOTHING').bind(user.id, ''),
    db.prepare('UPDATE notebooks SET revision = revision + 1, write_token = ?, updated_at = ? WHERE user_id = ? AND revision = ?').bind(token, Date.now(), user.id, revision),
  ];
  // Each batch is transactional. Every row write also checks this request's token:
  // a concurrent stale request cannot write even if another request advanced revision.
  const unique = new Map();
  for (const record of records) {
    const key = record.kind + ':' + record.key;
    const prior = unique.get(key);
    if (!prior || record.at > prior.at || record.at === prior.at && (record.by > prior.by || record.by === prior.by && (!record.by && record.payload.length !== prior.payload.length ? record.payload.length > prior.payload.length : record.payload > prior.payload))) unique.set(key, record);
  }
  const chunks = []; let chunk = [], size = 0;
  for (const record of unique.values()) {
    const bytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
    if (size + bytes > 900000 && chunk.length) { chunks.push(chunk); chunk = []; size = 0; }
    chunk.push(record); size += bytes;
  }
  if (chunk.length) chunks.push(chunk);
  for (const recordsChunk of chunks) {
    statements.push(db.prepare(`INSERT INTO notebook_records (user_id, kind, record_key, payload, modified_at, modified_by)
      SELECT ?, json_extract(value, '$.kind'), json_extract(value, '$.key'), json_extract(value, '$.payload'), json_extract(value, '$.at'), json_extract(value, '$.by')
      FROM json_each(?) WHERE EXISTS (SELECT 1 FROM notebooks WHERE user_id = ? AND write_token = ?)
      ON CONFLICT(user_id, kind, record_key) DO UPDATE SET payload = excluded.payload, modified_at = excluded.modified_at, modified_by = excluded.modified_by
      WHERE excluded.modified_at > notebook_records.modified_at
        OR (excluded.modified_at = notebook_records.modified_at AND excluded.modified_by > notebook_records.modified_by)
        OR (excluded.modified_at = notebook_records.modified_at AND excluded.modified_by = notebook_records.modified_by
          AND ((excluded.modified_by = '' AND length(excluded.payload) > length(notebook_records.payload))
            OR ((excluded.modified_by != '' OR length(excluded.payload) = length(notebook_records.payload)) AND excluded.payload > notebook_records.payload)))`)
      .bind(user.id, JSON.stringify(recordsChunk), user.id, token));
  }
  const result = await db.batch(statements);
  return result[1].meta.changes > 0;
}

export function createHandler(assets = ASSETS) {
  return async function fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/sync') {
      const user = getUser(request);
      if (!user) return json({ error: 'Eşitleme için ChatGPT hesabınla giriş yap.', code: 'sign_in_required' }, 401);
      if (!env.DB) return json({ error: 'Bulut veritabanı henüz hazır değil.', code: 'database_unavailable' }, 503);
      if (!['GET', 'PUT'].includes(request.method)) return json({ error: 'Desteklenmeyen işlem.' }, 405);
      try {
        if (request.method === 'GET') return json(await readNotebook(env.DB, user));
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'İstek kaynağı geçersiz.' }, 403);
        if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'JSON istek gerekli.' }, 415);
        let body;
        try { body = await readBody(request); } catch (error) { return json({ error: error.message === 'BODY_TOO_LARGE' ? 'Defter bu eşitleme için çok büyük.' : 'Geçersiz JSON.' }, error.message === 'BODY_TOO_LARGE' ? 413 : 400); }
        if (!Number.isSafeInteger(body?.baseRevision) || body.baseRevision < 0) return json({ error: 'Eşitleme sürümü geçersiz.' }, 400);
        let records;
        try { records = validateNotebook(body.notebook); } catch (error) { return json({ error: error.message }, 400); }
        const accepted = await saveNotebook(env.DB, user, body.baseRevision, records);
        return json(await readNotebook(env.DB, user), accepted ? 200 : 409);
      } catch {
        // Never include SQL errors, request headers or notebook contents in responses.
        return json({ error: 'Eşitleme tamamlanamadı. Cihazdaki kayıtların korunuyor.', code: 'sync_unavailable' }, 503);
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = assets[path];
    if (!asset) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : asset.body, { headers: {
      'Content-Type': asset.type, 'Cache-Control': path.startsWith('/vendor/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    } });
  };
}
export default { fetch: createHandler() };
