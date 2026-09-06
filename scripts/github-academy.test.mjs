import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  KEY_ID, MARKER, MAX_EXPANDED_BYTES, decodeSubmission,
  makeSigner, makeStore, processIssue, publishDirectory, RetryableValidationError,
} from './github-academy.mjs';

const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
const signer = makeSigner(key);
const now = '2026-09-06T12:00:00.000Z';
const requestId = 'a'.repeat(32);
const roundId = '10000000-0000-4000-8000-000000000001';
const profile = { displayName: 'Fixture referee', country: 'CZ', publicProfile: true };
const submission = (patch = {}) => ({ schema: 1, requestId, kind: 'connect', profile, ...patch });
function issue(payload = submission(), patch = {}) {
  return { number: 71, user: { id: 1234, login: 'fixture-referee', type: 'User' },
    body: `Public test fixture only.\n\n\`\`\`text\n${MARKER}${gzipSync(JSON.stringify(payload)).toString('base64url')}\n\`\`\``, ...patch };
}
const validate = (payload) => ({ profile: payload.profile,
  ...(payload.kind === 'certify' ? { summary: { rulesCorrect: 70, stepQualifying: 5, continuousQualifying: 2 } } : {}) });

test('compressed intake accepts the frontend protocol and rejects ambiguity, invalid base64, oversized gzip and paths', () => {
  assert.deepEqual(decodeSubmission(issue().body), submission());
  assert.throws(() => decodeSubmission(`${issue().body}\n${MARKER}eA`));
  assert.throws(() => decodeSubmission(`${MARKER}not!base64`));
  assert.throws(() => decodeSubmission(issue(submission({ requestId: '../secret' })).body));
  assert.throws(() => decodeSubmission('x'.repeat(65_537)));
  const bomb = gzipSync(Buffer.alloc(MAX_EXPANDED_BYTES + 1, 0x20));
  assert.throws(() => decodeSubmission(`${MARKER}${bomb.toString('base64url')}`));
  assert.throws(() => makeStore(signer).write('../secret.json', {}));
});

test('ES256 P1363 envelopes verify in browser WebCrypto and reject tampering and wrong keys', async () => {
  const envelope = signer.envelope({ public: 'fixture' });
  assert.equal(envelope.keyId, KEY_ID);
  assert.equal(Buffer.from(envelope.signature, 'base64url').length, 64);
  const browserKey = await webcrypto.subtle.importKey('jwk', signer.publicJwk,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, browserKey,
    Buffer.from(envelope.signature, 'base64url'), Buffer.from(envelope.payload, 'base64url')), true);
  assert.throws(() => signer.open({ ...envelope, payload: Buffer.from('{"public":"changed"}').toString('base64url') }));
  assert.throws(() => signer.open({ ...envelope, keyId: 'another-key' }));
  const otherKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
  assert.throws(() => makeSigner(otherKey).open(envelope));
});

test('authoritative GitHub author wins over claimed IDs and repeat processing does not reissue', async () => {
  const store = makeStore(signer);
  const forged = submission({ githubId: 1, githubLogin: 'admin', refereeNumber: 'RCJ-GH-1' });
  const first = await processIssue({ issue: issue(forged), store, validateSubmission: validate, now });
  assert.equal(first.githubId, 1234);
  assert.equal(first.githubLogin, 'fixture-referee');
  assert.equal(first.refereeNumber, 'RCJ-GH-1234');
  assert.equal(first.certificate, undefined);
  const count = store.overlay.size;
  const repeated = await processIssue({ issue: issue(forged), store,
    validateSubmission: () => { throw new Error('Must not run twice'); }, now });
  assert.deepEqual(repeated, first);
  assert.equal(store.overlay.size, count);
});

test('a duplicate request ID never overwrites its original signed receipt, including other authors', async () => {
  const store = makeStore(signer);
  await processIssue({ issue: issue(), store, validateSubmission: validate, now });
  const original = store.overlay.get(`requests/${requestId}.json`);
  const second = await processIssue({ issue: issue(submission(), { number: 72,
    user: { id: 999, login: 'another-user', type: 'User' } }), store, validateSubmission: validate, now });
  assert.equal(second.status, 'rejected');
  assert.equal(second.requestId, undefined);
  assert.equal(store.overlay.get(`requests/${requestId}.json`), original);
  assert.equal(store.read('accounts/999.json'), null);
});

test('certified rounds cannot be reused, invalid evidence produces only a rejection, and connect retains existing certificate', async () => {
  const store = makeStore(signer);
  const certify = submission({ kind: 'certify', round: { id: roundId } });
  const first = await processIssue({ issue: issue(certify), store, validateSubmission: validate, now });
  assert.equal(first.certificate.roundId, roundId);
  assert.equal(first.certificate.certifiedAt, now);
  assert.equal(first.certificate.verificationCode, requestId);
  const duplicate = await processIssue({ issue: issue({ ...certify, requestId: 'b'.repeat(32) }, { number: 72 }),
    store, validateSubmission: validate, now });
  assert.equal(duplicate.status, 'rejected');
  const connect = await processIssue({ issue: issue(submission({ requestId: 'c'.repeat(32) }), { number: 73 }),
    store, validateSubmission: validate, now });
  assert.deepEqual(connect.certificate, first.certificate);
  const invalid = await processIssue({ issue: issue(submission({ requestId: 'd'.repeat(32) }), { number: 74 }),
    store, validateSubmission: () => { throw new Error('private raw answer must not escape'); }, now });
  assert.equal(invalid.status, 'rejected');
  assert.ok(!JSON.stringify(invalid).includes('private raw answer'));
  assert.deepEqual(store.read('accounts/1234.json').certifiedRounds, [roundId]);
});

test('validation timeouts remain queued without rejection receipts and can succeed on a later run', async () => {
  const store = makeStore(signer);
  await assert.rejects(processIssue({ issue: issue(), store,
    validateSubmission: () => { throw new RetryableValidationError(); }, now }), RetryableValidationError);
  assert.equal(store.read(`requests/${requestId}.json`), null);
  assert.equal(store.read('issues/71.json'), null);
  assert.equal(store.read('accounts/1234.json'), null);
  assert.equal(store.overlay.size, 0);
  const retried = await processIssue({ issue: issue(), store, validateSubmission: validate, now });
  assert.equal(retried.status, 'accepted');
});

test('public directory has 16 signed hash-checked shards and respects directory consent', async () => {
  const store = makeStore(signer);
  await processIssue({ issue: issue(submission({ kind: 'certify', round: { id: roundId } })), store,
    validateSubmission: validate, now });
  assert.equal(publishDirectory(store, now), 1);
  const index = store.read('directory/index.json');
  assert.equal(index.total, 1);
  assert.equal(index.shards.length, 16);
  assert.equal(store.read('directory/2.json').records[0].githubId, 1234);
  assert.deepEqual(Object.keys(store.read('directory/2.json').records[0]).sort(),
    ['githubId', 'githubLogin', 'refereeNumber', 'displayName', 'country', 'season',
      'certifiedAt', 'verificationCode', 'issueNumber', 'roundId'].sort());
  assert.ok(store.read(`requests/${requestId}.json`).certificate.summary);
  for (const shard of index.shards) {
    assert.equal(createHash('sha256').update(store.overlay.get(shard.path)).digest('hex'), shard.sha256);
    assert.equal(store.read(shard.path).records.length, shard.count);
  }
  await processIssue({ issue: issue(submission({ requestId: 'b'.repeat(32), profile: { ...profile, publicProfile: false } }), { number: 72 }),
    store, validateSubmission: validate, now });
  assert.equal(publishDirectory(store, now), 0);
  assert.equal(store.read('directory/2.json').records.length, 0);
  // Directory consent is not a claim that public issue evidence or receipts vanish.
  assert.ok(store.read(`requests/${requestId}.json`).certificate);
});

test('malformed payloads and bot submissions cannot mint credentials or expose validator errors', async () => {
  const store = makeStore(signer);
  const malformed = await processIssue({ issue: issue(null, { body: `${MARKER}broken` }), store, validateSubmission: validate, now });
  assert.equal(malformed.status, 'rejected');
  const bot = await processIssue({ issue: issue(submission(), { number: 72, user: { id: 11, login: 'some-bot', type: 'Bot' } }),
    store, validateSubmission: validate, now });
  assert.equal(bot.status, 'rejected');
  assert.equal(store.read(`requests/${requestId}.json`), null);
  assert.equal(await processIssue({ issue: issue(null, { number: 73, body: 'Unrelated normal issue' }), store, validateSubmission: validate, now }), null);
});

test('store refuses unsigned branch data and symlink redirects', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'rcj-academy-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = makeStore(signer, directory);
  store.write('requests/' + requestId + '.json', { fixture: true });
  const path = join(directory, 'requests', requestId + '.json');
  writeFileSync(path, JSON.stringify({ payload: 'e30', signature: 'x'.repeat(86), keyId: KEY_ID }));
  assert.throws(() => makeStore(signer, directory).read('requests/' + requestId + '.json'));
  if (process.platform !== 'win32') {
    symlinkSync(tmpdir(), join(directory, 'accounts'));
    assert.throws(() => store.write('accounts/123.json', {}));
  }
});

test('a fresh queue run recovers committed results without another validation or changed receipt', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'rcj-academy-recovery-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const originalStore = makeStore(signer, directory);
  const original = await processIssue({ issue: issue(), store: originalStore, validateSubmission: validate, now });
  const receiptPath = join(directory, 'requests', requestId + '.json');
  const bytes = readFileSync(receiptPath, 'utf8');
  // Simulate a job stopping after publishing its commit but before closing the issue.
  const recoveredStore = makeStore(signer, directory);
  const recovered = await processIssue({ issue: issue(), store: recoveredStore,
    validateSubmission: () => { throw new Error('Recovery must not validate again'); }, now });
  assert.deepEqual(recovered, original);
  assert.equal(recoveredStore.overlay.size, 0);
  assert.equal(readFileSync(receiptPath, 'utf8'), bytes);
  recoveredStore.write('state/scan.json', { schema: 1, nextPage: 1 });
  const idleStore = makeStore(signer, directory);
  idleStore.write('state/scan.json', { schema: 1, nextPage: 1 });
  assert.equal(idleStore.overlay.size, 0, 'idle queue reconciliation must not create empty commits');
});

test('10,000 mock directory accounts remain bounded during publication and a small profile update', { timeout: 120_000 }, (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'rcj-academy-scale-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // This generated key is unrelated to the provisioned issuer key. These clearly
  // marked fixture certificates never leave a temporary local directory.
  const fixtureKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
  const fixtureSigner = makeSigner(fixtureKey);
  const seeded = makeStore(fixtureSigner, directory);
  const seedStart = performance.now();
  for (let index = 1; index <= 10_000; index++) {
    const fixtureRound = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    seeded.write(`accounts/${index}.json`, {
      schema: 1, githubId: index, githubLogin: `mock-fixture-${index}`,
      profile: { displayName: `MOCK FIXTURE ${index}`, country: 'TEST ONLY', publicProfile: true },
      certifiedRounds: [fixtureRound],
      certificate: {
        githubId: index, githubLogin: `mock-fixture-${index}`, refereeNumber: `RCJ-GH-${index}`,
        displayName: `MOCK FIXTURE ${index}`, country: 'TEST ONLY', season: '2026',
        certifiedAt: now, verificationCode: index.toString(16).padStart(32, '0'),
        issueNumber: index, roundId: fixtureRound,
        summary: { rulesCorrect: 70, rulesTotal: 73, stepQualifying: 5, continuousQualifying: 2,
          stepAttempts: 5, continuousAttempts: 2, policyVersion: 'mock-performance-fixture',
          games: Array.from({ length: 7 }, (_, game) => ({ id: `fixture-${game}`, mode: game < 5 ? 'step' : 'continuous', accuracy: 100, qualifying: true })) },
      }, updatedAt: now,
    });
  }
  const seedMs = performance.now() - seedStart;
  const accountBytes = [...seeded.overlay.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0);
  // Clear the cache to measure real on-disk verification/scanning, as happens in
  // each independent Actions run, instead of just reading the fixture overlay.
  seeded.overlay.clear();
  const store = makeStore(fixtureSigner, directory);
  const publishStart = performance.now();
  assert.equal(publishDirectory(store, now), 10_000);
  const publishMs = performance.now() - publishStart;
  const manifest = store.read('directory/index.json');
  assert.equal(manifest.shards.length, 16);
  assert.ok(manifest.shards.every((shard) => shard.count === 625));
  const directoryBytes = [...store.overlay.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0);
  const largestShardBytes = Math.max(...manifest.shards.map((shard) => Buffer.byteLength(store.overlay.get(shard.path))));
  assert.ok(largestShardBytes < 8 * 1024 * 1024, 'each shard must fit the browser reader limit');
  assert.ok(directoryBytes < 5 * 1024 * 1024, 'directory projection must not copy detailed game summaries');
  store.overlay.clear();
  const updateStore = makeStore(fixtureSigner, directory);
  const updateStart = performance.now();
  const account = updateStore.read('accounts/1234.json');
  updateStore.write('accounts/1234.json', {
    ...account, profile: { ...account.profile, displayName: 'MOCK FIXTURE UPDATED' },
  });
  assert.equal(publishDirectory(updateStore, '2026-09-06T12:01:00.000Z'), 10_000);
  const updateMs = performance.now() - updateStart;
  assert.equal(updateStore.read('directory/2.json').records.find((row) => row.githubId === 1234).displayName, 'MOCK FIXTURE UPDATED');
  assert.equal(updateStore.overlay.size, 3, 'only account, its changed shard, and manifest should be rewritten');
  const changedBytes = [...updateStore.overlay.values()].reduce((sum, content) => sum + Buffer.byteLength(content), 0);
  const peakRssMiB = process.resourceUsage().maxRSS / 1024;
  const heapUsedMiB = process.memoryUsage().heapUsed / 1024 / 1024;
  assert.ok(heapUsedMiB < 256, 'the account scan must stay below 256 MiB of JavaScript heap');
  assert.ok(peakRssMiB < 512, 'the scale fixture must stay below 512 MiB peak resident memory');
  t.diagnostic(JSON.stringify({ accounts: 10_000, seedMs: Math.round(seedMs),
    publishMs: Math.round(publishMs), singleProfileUpdateMs: Math.round(updateMs),
    signedAccountBytes: accountBytes, signedDirectoryBytes: directoryBytes,
    largestShardBytes, changedBytes, changedFiles: updateStore.overlay.size,
    heapUsedMiB: Math.round(heapUsedMiB), peakRssMiB: Math.round(peakRssMiB) }));
});

test('dry run uses real trusted validation with no network, file changes, or production credentials', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'rcj-academy-dryrun-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'issues.json');
  const source = JSON.stringify([issue()]);
  writeFileSync(path, source);
  const env = { ...process.env };
  delete env.ACADEMY_SIGNING_KEY;
  delete env.GITHUB_TOKEN;
  const result = spawnSync(process.execPath, ['scripts/github-academy.mjs', '--dry-run', '--issues-file', path],
    { cwd: new URL('../', import.meta.url), env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.rejected, 0);
  assert.equal(readFileSync(path, 'utf8'), source);
});
