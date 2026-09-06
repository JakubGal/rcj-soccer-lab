import { execFileSync } from 'node:child_process';
const repository = 'JakubGal/rcj-soccer-lab';
function api(path, body) {
  return JSON.parse(
    execFileSync(
      'gh',
      [
        'api',
        `repos/${repository}/${path}`,
        ...(body ? ['--method', 'POST', '--input', '-'] : []),
      ],
      {
        encoding: 'utf8',
        ...(body ? { input: JSON.stringify(body) } : {}),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ),
  );
}
if (!process.argv.includes('--bootstrap'))
  throw new Error('Pass --bootstrap for one-time public data branch setup.');
let exists = false;
try {
  api('git/ref/heads/academy-data');
  exists = true;
} catch (error) {
  if (!String(error.stderr).includes('404'))
    throw new Error('Could not verify the data branch.');
}
if (exists) {
  process.stdout.write('academy-data already exists; unchanged.\n');
  process.exit(0);
}
const blob = api('git/blobs', {
  content:
    '# RCJ Soccer Lab public training records\n\nThis branch contains issuer-signed public mock-certification records. Private training progress stays on the participant device. Never add credentials or private information here.\n',
  encoding: 'utf-8',
});
const tree = api('git/trees', {
  tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }],
});
const commit = api('git/commits', {
  message: 'Initialize public mock academy records',
  tree: tree.sha,
  parents: [],
});
api('git/refs', { ref: 'refs/heads/academy-data', sha: commit.sha });
process.stdout.write(
  'Created academy-data without changing the source branch.\n',
);
