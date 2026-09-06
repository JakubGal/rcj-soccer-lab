import { execFileSync } from 'node:child_process';
import { registerTrustedTypes } from './github-academy.mjs';
registerTrustedTypes();
const { prepareSubmission } = await import('../lib/github/protocol.ts');
const { readReceipt } = await import('../lib/github/registry.ts');
const repository = 'JakubGal/rcj-soccer-lab';

if (process.argv.includes('--submit-connect-test')) {
  // Real repository-owner identity only. This does NOT submit a passing exam,
  // issue any certificate, or opt the owner into the public directory.
  const user = JSON.parse(
    execFileSync('gh', ['api', 'user'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  if (user.login.toLowerCase() !== 'jakubgal')
    throw new Error('Run this integration test as the repository owner.');
  const requestId = crypto.randomUUID().replaceAll('-', '');
  const request = await prepareSubmission({
    schema: 1,
    requestId,
    kind: 'connect',
    profile: { displayName: user.login, country: '', publicProfile: false },
  });
  const issue = JSON.parse(
    execFileSync(
      'gh',
      ['api', `repos/${repository}/issues`, '--method', 'POST', '--input', '-'],
      {
        input: JSON.stringify({
          title: `[RCJ Academy] Infrastructure connection test ${requestId}`,
          body: request.body,
        }),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ),
  );
  process.stdout.write(
    JSON.stringify({
      requestId,
      issueNumber: issue.number,
      url: issue.html_url,
      expectedGithubId: user.id,
    }) + '\n',
  );
} else if (process.argv.includes('--check')) {
  const requestId = process.argv[process.argv.indexOf('--check') + 1];
  const result = await readReceipt(requestId);
  if (!result) throw new Error('Signed result is still pending.');
  if (
    result.payload.status !== 'accepted' ||
    result.payload.kind !== 'connect' ||
    result.payload.certificate
  )
    throw new Error('Unexpected integration-test result.');
  process.stdout.write(
    JSON.stringify({
      signatureValid: true,
      requestId,
      githubLogin: result.payload.githubLogin,
      refereeNumber: result.payload.refereeNumber,
      certificateIssued: false,
    }) + '\n',
  );
} else {
  process.stdout.write(
    'Use --submit-connect-test once, then --check <requestId>. Never submit synthetic passing exams to the live registry.\n',
  );
}
