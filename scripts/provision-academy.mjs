import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// One-time owner setup. The private key exists only in memory and goes to gh's
// stdin, never a file, shell argument, frontend bundle or command output.
if (!process.argv.includes('--provision'))
  throw new Error(
    'Pass --provision to configure the GitHub Actions signing secret.',
  );
const names = execFileSync(
  'gh',
  ['secret', 'list', '--repo', 'JakubGal/rcj-soccer-lab', '--json', 'name'],
  { encoding: 'utf8' },
);
if (JSON.parse(names).some((entry) => entry.name === 'ACADEMY_SIGNING_KEY'))
  throw new Error(
    'Signing secret already exists. Use the documented key rotation process; do not replace it accidentally.',
  );
const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});
execFileSync(
  'gh',
  ['secret', 'set', 'ACADEMY_SIGNING_KEY', '--repo', 'JakubGal/rcj-soccer-lab'],
  {
    input: JSON.stringify(privateKey.export({ format: 'jwk' })),
    stdio: ['pipe', 'pipe', 'pipe'],
  },
);
process.stdout.write(
  JSON.stringify(publicKey.export({ format: 'jwk' })) + '\n',
);
