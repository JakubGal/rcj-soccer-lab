import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const outputDirectory = join(process.cwd(), 'dist', 'client');
const [owner = 'JakubGal', repository = 'rcj-soccer-lab'] = (
  process.env.GITHUB_REPOSITORY ?? 'JakubGal/rcj-soccer-lab'
).split('/');
const isOwnerSite =
  repository.toLowerCase() === `${owner.toLowerCase()}.github.io`;
const basePath = isOwnerSite ? '' : `/${repository}`;
const pagesUrl = `https://${owner.toLowerCase()}.github.io${basePath}`;
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.rsc']);

async function collectTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTextFiles(path)));
    } else if (textExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

const files = await collectTextFiles(outputDirectory);
const rootNextPath = /(?<![A-Za-z0-9._~:/-])\/_next\//g;

for (const file of files) {
  const original = await readFile(file, 'utf8');
  const updated = original.replace(rootNextPath, `${pagesUrl}/_next/`);
  if (updated !== original) await writeFile(file, updated);
}

const indexPath = join(outputDirectory, 'index.html');
const indexHtml = await readFile(indexPath, 'utf8');

if (!indexHtml.includes(`${pagesUrl}/_next/`)) {
  throw new Error(
    'The static entry point does not reference the Pages assets.',
  );
}

if (rootNextPath.test(indexHtml)) {
  throw new Error(
    'The static entry point still contains root-relative assets.',
  );
}

console.log(`GitHub Pages artifact finalized for ${pagesUrl}/`);
