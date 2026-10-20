import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import worker from '../dist/server/index.js';
const root = resolve(import.meta.dirname, '..');
mkdirSync(resolve(root, '.sites-runtime'), { recursive: true });
const database = new DatabaseSync(resolve(root, '.sites-runtime/preview.sqlite'));
database.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
for (const name of readdirSync(resolve(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) {
  if (database.prepare('SELECT name FROM local_migrations WHERE name = ?').get(name)) continue;
  database.exec('BEGIN');
  try {
    database.exec(readFileSync(resolve(root, 'drizzle', name), 'utf8'));
    database.prepare('INSERT INTO local_migrations(name) VALUES (?)').run(name);
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
const DB = {
  prepare(sql) { return { sql, args: [], bind(...args) { return { sql, args }; } }; },
  async batch(statements) {
    database.exec('BEGIN');
    try {
      const results = statements.map(({ sql, args }) => {
        const statement = database.prepare(sql);
        if (/^\s*SELECT/i.test(sql)) return { results: statement.all(...args), meta: { changes: 0 } };
        const result = statement.run(...args); return { results: [], meta: { changes: Number(result.changes) } };
      });
      database.exec('COMMIT'); return results;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  },
};
const port = Number(process.env.KELIME_PREVIEW_PORT || 4174);
createServer(async (incoming, outgoing) => {
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    // This identity is local preview only. Production uses Sites' trusted sign-in headers.
    headers.set('oai-authenticated-user-id', 'kelime-local-preview');
    headers.set('oai-authenticated-user-email', 'Yerel önizleme');
    const init = { method: incoming.method, headers };
    if (!['GET', 'HEAD'].includes(incoming.method)) { init.body = Readable.toWeb(incoming); init.duplex = 'half'; }
    const host = incoming.headers.host;
    if (!['127.0.0.1:' + port, 'localhost:' + port].includes(host)) { outgoing.writeHead(403); outgoing.end('Invalid preview host'); return; }
    const request = new Request('http://' + host + incoming.url, init);
    const response = await worker.fetch(request, { DB });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end('Preview request failed.'); }
}).listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + port + '/ (local test account only)'));
