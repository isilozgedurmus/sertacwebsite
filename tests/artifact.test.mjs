import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
try {
  const { default: worker } = await import('../dist/server/index.js');
  assert.equal(typeof worker.fetch, 'function');
  for (const [path, source] of [['/', 'index.html'], ['/app.js', 'app.js'], ['/sync.js', 'sync.js'], ['/vendor/transformers-2.17.2.min.js', 'vendor/transformers-2.17.2.min.js']]) {
    const result = await worker.fetch(new Request('https://kelime.test' + path), {});
    assert.equal(result.status, 200);
    assert.equal(await result.text(), await readFile(new URL('../web/' + source, import.meta.url), 'utf8'), path + ' must preserve the exact source bytes.');
  }
  const auth = await worker.fetch(new Request('https://kelime.test/api/sync'), {});
  assert.equal(auth.status, 401);
  console.log('PASS: packaged Worker parses, exact embedded frontend contents, unauthenticated API denied.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
