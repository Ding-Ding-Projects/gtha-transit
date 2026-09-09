import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist/client');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const version = JSON.parse(await readFile(path.join(root, 'version.json'), 'utf8'));
if (!/^[a-f0-9]{40}$/.test(version.commit) || !Number.isFinite(Date.parse(version.builtAt))) throw new Error('A valid build version is required before producing its receipt.');
const files = [];
async function visit(directory) {
  for (const name of (await readdir(directory)).sort()) {
    const file = path.join(directory, name), relative = path.relative(root, file).replaceAll(path.sep, '/');
    if (['asset-manifest.json', 'build-receipt.json'].includes(relative)) continue;
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error('Static build output must not contain links.');
    if (info.isDirectory()) await visit(file);
    else if (info.isFile()) files.push({ path: relative, bytes: info.size, sha256: hash(await readFile(file)) });
  }
}
await visit(root);
const manifest = JSON.stringify({ schemaVersion: 1, kind: 'static-site-assets', sourceCommit: version.commit, version: version.version, builtAt: version.builtAt, files }, null, 2) + '\n';
await writeFile(path.join(root, 'asset-manifest.json'), manifest);
await writeFile(path.join(root, 'build-receipt.json'), JSON.stringify({ schemaVersion: 1, sourceCommit: version.commit, version: version.version, builtAt: version.builtAt, completedAt: new Date().toISOString(), artifactKind: 'static-site-asset-manifest', artifactPath: 'asset-manifest.json', artifactSha256: hash(manifest), assetCount: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }, null, 2) + '\n');
console.log(`Build receipt records ${files.length} static assets for ${version.commit}.`);
