import { rm, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import './build.mjs';
const root = resolve(import.meta.dirname, '..');
await rm(resolve(root, '.aws-build'), { recursive: true, force: true });
await mkdir(resolve(root, '.aws-build'), { recursive: true });
const output = resolve(root, '.aws-build');
await mkdir(resolve(output, 'aws'), { recursive: true });
await mkdir(resolve(output, 'dist/server'), { recursive: true });
for (const path of ['aws/handler.mjs', 'aws/notebook-store.mjs', 'dist/server/index.js']) {
  await cp(resolve(root, path), resolve(output, path));
}
await writeFile(resolve(output, 'index.mjs'), "export { handler } from './aws/handler.mjs';\n");
await writeFile(resolve(output, 'package.json'), JSON.stringify({ type: 'module', private: true }));
// Ship the exact locked production SDKs instead of depending on the runtime's
// bundled SDK version. No native compiler or platform-specific binary is needed.
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
let dependencies = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path.startsWith('node_modules/') || entry.dev) continue;
  await mkdir(resolve(output, path, '..'), { recursive: true });
  await cp(resolve(root, path), resolve(output, path), { recursive: true });
  dependencies++;
}
console.log('Built portable Lambda package with ' + dependencies + ' locked production dependencies.');
