import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const source = join(root, 'web');
const assets = {};
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '': 'text/plain; charset=utf-8' };
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + '/' + entry.name;
    if (entry.isDirectory()) await collect(join(directory, entry.name), relative);
    else if (entry.isFile()) assets[relative] = { type: types[extname(entry.name)] || 'text/plain; charset=utf-8', body: await readFile(join(directory, entry.name), 'utf8') };
    else throw Error('Frontend assets must be regular files.');
  }
}
await collect(source);
const worker = await readFile(join(root, 'worker/index.js'), 'utf8');
const manifest = JSON.parse(await readFile(join(root, '.openai/hosting.json'), 'utf8'));
if (manifest.static != null || manifest.d1 !== 'DB') throw Error('Worker build requires the DB binding and no static configuration.');
await rm(join(root, 'dist'), { recursive: true, force: true });
await mkdir(join(root, 'dist/server'), { recursive: true });
await mkdir(join(root, 'dist/.openai'), { recursive: true });
await writeFile(join(root, 'dist/server/index.js'), worker.replace('const ASSETS = Object.freeze({});', () => 'const ASSETS = Object.freeze(' + JSON.stringify(assets) + ');'));
await writeFile(join(root, 'dist/.openai/hosting.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Built authenticated Worker with ' + Object.keys(assets).length + ' embedded frontend assets.');
