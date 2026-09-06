import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

// This is a public, asynchronous MOCK academy queue, not an authentication server.
// Only trusted default-branch code runs. All submission fields remain untrusted data.
export const KEY_ID = 'academy-2026-v1';
export const MARKER = 'RCJ-ACADEMY-V1:';
export const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const REQUEST_ID = /^[a-f0-9]{32}$/;
const SAFE_PATH = /^(?:requests\/[a-f0-9]{32}|accounts\/[1-9][0-9]{0,15}|issues\/[1-9][0-9]{0,15}|directory\/(?:[a-f0-9]|index)|state\/scan)\.json$/;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = fileURLToPath(import.meta.url);

export class RetryableValidationError extends Error {
  constructor(message = 'Validation infrastructure was unavailable or exceeded its resource limit.') {
    super(message);
    this.name = 'RetryableValidationError';
  }
}

export function decodeSubmission(body) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 65_536)
    throw new Error('Invalid submission size.');
  if (body.split(MARKER).length !== 2)
    throw new Error('Exactly one submission marker is required.');
  const match = body.match(/(?:^|\n)RCJ-ACADEMY-V1:[ \t]*(?:\r?\n)?([A-Za-z0-9_-]{1,60000})[ \t]*(?:\r?\n|$)/);
  if (!match) throw new Error('Invalid submission encoding.');
  const compressed = Buffer.from(match[1], 'base64url');
  if (compressed.toString('base64url') !== match[1])
    throw new Error('Invalid submission encoding.');
  const bytes = gunzipSync(compressed, { maxOutputLength: MAX_EXPANDED_BYTES });
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.schema !== 1 || !REQUEST_ID.test(value.requestId) ||
      !['connect', 'certify'].includes(value.kind))
    throw new Error('Invalid submission protocol.');
  return value;
}

export function makeSigner(privateJwk) {
  if (privateJwk?.kty !== 'EC' || privateJwk?.crv !== 'P-256' || !privateJwk.d)
    throw new Error('The issuer needs an EC P-256 private JWK.');
  const privateKey = createPrivateKey({ key: privateJwk, format: 'jwk' });
  const publicKey = createPublicKey(privateKey);
  return {
    publicJwk: publicKey.export({ format: 'jwk' }),
    envelope(value) {
      const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
      const signature = sign('sha256', Buffer.from(payload, 'base64url'), {
        key: privateKey, dsaEncoding: 'ieee-p1363',
      }).toString('base64url');
      return { payload, signature, keyId: KEY_ID };
    },
    open(envelope) {
      if (envelope?.keyId !== KEY_ID || typeof envelope.payload !== 'string' ||
          typeof envelope.signature !== 'string' ||
          !/^[A-Za-z0-9_-]+$/.test(envelope.payload) ||
          !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))
        throw new Error('Invalid signed issuer record.');
      const bytes = Buffer.from(envelope.payload, 'base64url');
      const signature = Buffer.from(envelope.signature, 'base64url');
      if (bytes.toString('base64url') !== envelope.payload ||
          signature.toString('base64url') !== envelope.signature ||
          !verify('sha256', bytes, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature))
        throw new Error('Issuer record signature mismatch.');
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    },
  };
}

export function makeStore(signer, directory = null, dryRun = false) {
  const root = directory ? realpathSync(directory) : null;
  const overlay = new Map();
  function pathFor(path) {
    if (!SAFE_PATH.test(path)) throw new Error('Unsafe issuer record path.');
    if (!root) return null;
    const target = resolve(root, path);
    if (!target.startsWith(`${root}${sep}`)) throw new Error('Unsafe issuer root.');
    // A malicious data-branch symlink must never redirect issuer writes.
    for (const segment of [dirname(target), target]) {
      if (existsSync(segment) && lstatSync(segment).isSymbolicLink())
        throw new Error('Symlinks are not allowed in issuer records.');
    }
    return target;
  }
  return {
    overlay,
    read(path) {
      const target = pathFor(path);
      const content = overlay.get(path) ?? (target && existsSync(target)
        ? (() => {
          if (lstatSync(target).size > MAX_FILE_BYTES) throw new Error('Issuer record is too large.');
          return readFileSync(target, 'utf8');
        })() : null);
      return content === null ? null : signer.open(JSON.parse(content));
    },
    write(path, payload) {
      const target = pathFor(path);
      const previous = this.read(path);
      if (previous !== null && JSON.stringify(previous) === JSON.stringify(payload))
        return overlay.get(path) ?? readFileSync(target, 'utf8');
      const content = `${JSON.stringify(signer.envelope(payload))}\n`;
      if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error('Issuer record is too large.');
      overlay.set(path, content);
      if (target && !dryRun) {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, { flag: 'w' });
      }
      return content;
    },
    accounts() {
      const paths = new Set([...overlay.keys()].filter((path) => path.startsWith('accounts/')));
      if (root && existsSync(resolve(root, 'accounts'))) {
        if (lstatSync(resolve(root, 'accounts')).isSymbolicLink()) throw new Error('Unsafe accounts directory.');
        for (const name of readdirSync(resolve(root, 'accounts'))) {
          if (!/^[1-9][0-9]{0,15}\.json$/.test(name)) throw new Error('Invalid account record filename.');
          paths.add(`accounts/${name}`);
        }
      }
      if (paths.size > 100_000) throw new Error('Account directory capacity exceeded.');
      return [...paths].map((path) => this.read(path));
    },
  };
}

function identityFor(issue) {
  if (!Number.isSafeInteger(issue?.number) || issue.number < 1 ||
      !Number.isSafeInteger(issue?.user?.id) || issue.user.id < 1 ||
      typeof issue.user.login !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(issue.user.login) ||
      issue.user.type !== 'User' || issue.pull_request)
    throw new Error('Only a GitHub user issue can submit an academy request.');
  return {
    githubId: issue.user.id,
    githubLogin: issue.user.login,
    refereeNumber: `RCJ-GH-${issue.user.id}`,
    issueNumber: issue.number,
  };
}

export async function processIssue({ issue, store, validateSubmission, now = new Date().toISOString() }) {
  if (!Number.isSafeInteger(issue?.number) || issue.number < 1) return null;
  const processedPath = `issues/${issue.number}.json`;
  const processed = store.read(processedPath);
  if (processed) return processed;
  if (typeof issue.body !== 'string' || !issue.body.includes(MARKER) || issue.pull_request) return null;
  const fallback = { schema: 1, issueNumber: issue.number, status: 'rejected',
    message: 'The public mock academy submission was not accepted. Create a new submission from the academy page.', processedAt: now };
  let identity;
  let payload;
  try {
    identity = identityFor(issue);
    payload = decodeSubmission(issue.body);
  } catch {
    store.write(processedPath, fallback);
    return fallback;
  }
  const requestPath = `requests/${payload.requestId}.json`;
  const previousRequest = store.read(requestPath);
  if (previousRequest && (previousRequest.issueNumber !== issue.number || previousRequest.githubId !== identity.githubId)) {
    const collision = { ...fallback, ...identity,
      message: 'This request identifier was already used. Create a fresh request from the academy page.' };
    store.write(processedPath, collision);
    return collision;
  }
  // A receipt and ledger are committed together. This also recovers a prior receipt
  // if a maintainer repaired only the processing ledger.
  if (previousRequest) {
    const restored = { ...previousRequest, schema: 1, processedAt: now };
    store.write(processedPath, restored);
    return restored;
  }
  const accountPath = `accounts/${identity.githubId}.json`;
  const account = store.read(accountPath);
  if (account && account.githubId !== identity.githubId) throw new Error('Account identity mismatch.');
  let receipt;
  try {
    const validated = await validateSubmission(payload);
    if (!validated?.profile || typeof validated.profile.displayName !== 'string' ||
        !validated.profile.displayName.trim() || validated.profile.displayName.length > 60 ||
        typeof validated.profile.country !== 'string' || validated.profile.country.length > 80 ||
        typeof validated.profile.publicProfile !== 'boolean')
      throw new Error('Invalid validated profile.');
    let certificate = account?.certificate;
    const rounds = account?.certifiedRounds ?? [];
    if (!Array.isArray(rounds) || rounds.length > 10_000) throw new Error('Round capacity exceeded.');
    if (payload.kind === 'certify') {
      if (typeof payload.round?.id !== 'string' || !validated.summary || rounds.includes(payload.round.id))
        throw new Error('Already issued round or incomplete validation.');
      certificate = {
        ...identity,
        displayName: validated.profile.displayName,
        country: validated.profile.country,
        season: '2026',
        certifiedAt: now,
        verificationCode: payload.requestId,
        roundId: payload.round.id,
        summary: validated.summary,
      };
      rounds.push(payload.round.id);
    }
    // Profile changes alter directory display, but never rewrite a signed certificate.
    const nextAccount = { schema: 1, ...identity, profile: validated.profile,
      certifiedRounds: rounds, ...(certificate ? { certificate } : {}), updatedAt: now };
    receipt = { schema: 1, requestId: payload.requestId, kind: payload.kind, status: 'accepted',
      ...identity, profile: validated.profile,
      message: payload.kind === 'certify'
        ? 'The submitted practice evidence passed the mock academy checks. This is not an official RoboCup qualification.'
        : 'GitHub account linked for public mock academy submissions. This is not a private login session.',
      ...(certificate ? { certificate } : {}) };
    store.write(accountPath, nextAccount);
  } catch (error) {
    // Infrastructure failures must not turn a legitimate queued submission into
    // a permanent rejection. The batch stops before committing or acknowledging.
    if (error instanceof RetryableValidationError) throw error;
    receipt = { schema: 1, requestId: payload.requestId, kind: payload.kind,
      status: 'rejected', ...identity,
      message: 'The submission did not pass the mock academy checks, or this round was already certified. Review your progress and submit a new request.' };
  }
  store.write(requestPath, receipt);
  const outcome = { ...receipt, processedAt: now };
  store.write(processedPath, outcome);
  return outcome;
}

export function publishDirectory(store, now = new Date().toISOString()) {
  const groups = Array.from({ length: 16 }, () => []);
  for (const account of store.accounts()) {
    if (!Number.isSafeInteger(account?.githubId) || account.githubId < 1)
      throw new Error('Invalid directory identity.');
    if (account.profile?.publicProfile && account.certificate) {
      const certificate = account.certificate;
      // A searchable directory is a small projection, not a copy of every game
      // report. Full signed certificates and summaries stay in public receipts.
      groups[account.githubId % 16].push({
        githubId: account.githubId,
        githubLogin: account.githubLogin,
        refereeNumber: certificate.refereeNumber,
        displayName: account.profile.displayName,
        country: account.profile.country,
        season: certificate.season,
        certifiedAt: certificate.certifiedAt,
        verificationCode: certificate.verificationCode,
        issueNumber: certificate.issueNumber,
        roundId: certificate.roundId,
      });
    }
  }
  let total = 0;
  const shards = groups.map((records, index) => {
    records.sort((a, b) => a.githubId - b.githubId);
    const path = `directory/${index.toString(16)}.json`;
    const content = store.write(path, { schema: 1, shard: index.toString(16), records });
    total += records.length;
    return { path, sha256: createHash('sha256').update(content).digest('hex'), count: records.length };
  });
  store.write('directory/index.json', { schema: 1, shards, total, updatedAt: now });
  return total;
}

export function registerTrustedTypes() {
  const rootUrl = pathToFileURL(`${ROOT}${sep}`).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@/')) {
        const path = specifier.slice(2);
        return nextResolve(new URL(/\.(?:ts|json)$/.test(path) ? path : `${path}.ts`, rootUrl).href, context);
      }
      if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith(`${rootUrl}lib/`) &&
          !/\.(?:ts|json)$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith(`${rootUrl}lib/`) && url.endsWith('.json'))
        return { format: 'module', shortCircuit: true, source: `export default ${readFileSync(new URL(url), 'utf8')}` };
      if (url.startsWith(`${rootUrl}lib/`) && url.endsWith('.ts'))
        return { format: 'module', shortCircuit: true,
          source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform', sourceUrl: url }) };
      return nextLoad(url, context);
    },
  });
}

function validateInChild(payload) {
  // Do not inherit GITHUB_TOKEN, ACADEMY_SIGNING_KEY, git credentials, or other
  // repository secrets into the process which parses/replays submission data.
  const env = {};
  for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR'])
    if (process.env[key]) env[key] = process.env[key];
  const result = spawnSync(process.execPath, ['--max-old-space-size=256', SCRIPT, '--validate'], {
    cwd: ROOT, env, input: JSON.stringify(payload), encoding: 'utf8',
    timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  if (result.error || result.signal || result.status === null || result.status === 2)
    throw new RetryableValidationError();
  if (result.status !== 0) throw new Error('Submission validation failed.');
  try { return JSON.parse(result.stdout); }
  catch { throw new RetryableValidationError('Validator returned an unreadable result.'); }
}

function git(directory, args, authenticated = false) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  delete env.ACADEMY_SIGNING_KEY;
  if (authenticated) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString('base64')}`;
  }
  try {
    return execFileSync('git', ['-C', directory, ...args], {
      env, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch { throw new Error('Issuer data git operation failed; no issue acknowledgments were sent.'); }
}

function githubApi(repository, token) {
  let requests = 0;
  let writes = 0;
  return async (path, method = 'GET', body) => {
    if (++requests > 220 || !/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues(?:[/?]|$)/.test(path))
      throw new Error('GitHub API batch budget or path restriction reached.');
    if (!path.startsWith(`/repos/${repository}/issues`)) throw new Error('Unexpected GitHub repository.');
    if (method !== 'GET') {
      if (++writes > 100) throw new Error('GitHub write budget reached.');
      await new Promise((done) => setTimeout(done, 1100));
    }
    const response = await fetch(`https://api.github.com${path}`, {
      method, signal: AbortSignal.timeout(20_000), redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // Stop the batch on throttling. The durable queue is retried in a later run.
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}; the durable queue will retry later.`);
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error('GitHub response exceeds batch limit.');
    return text ? JSON.parse(text) : null;
  };
}

async function acknowledge(api, repository, outcome) {
  const issuePath = `/repos/${repository}/issues/${outcome.issueNumber}`;
  const marker = `<!-- rcj-academy-receipt:${outcome.issueNumber} -->`;
  let found = false;
  for (let page = 1; page <= 5; page++) {
    const comments = await api(`${issuePath}/comments?per_page=100&page=${page}`);
    found = comments.some((comment) => comment.user?.login === 'github-actions[bot]' && comment.body?.includes(marker));
    if (found || comments.length < 100) break;
    if (page === 5) return; // Do not duplicate a receipt hidden beyond our scan budget.
  }
  if (!found) {
    const receiptLink = outcome.requestId && REQUEST_ID.test(outcome.requestId)
      ? `\n\n[Signed public receipt](https://raw.githubusercontent.com/${repository}/academy-data/requests/${outcome.requestId}.json)` : '';
    await api(`${issuePath}/comments`, 'POST', {
      body: `${marker}\n${outcome.message}${receiptLink}\n\nThis workflow checks submitted practice evidence. It does not establish identity, prevent cheating, or issue an official RoboCup qualification.`,
    });
  }
  await api(issuePath, 'PATCH', { state: 'closed', state_reason: 'completed' });
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv.includes('--validate')) {
    const source = readFileSync(0);
    if (source.length > MAX_EXPANDED_BYTES) throw new Error('Validation input exceeds limit.');
    let validateSubmission;
    try {
      registerTrustedTypes();
      ({ validateSubmission } = await import('../lib/github/validate.ts'));
    } catch {
      throw new RetryableValidationError('Trusted validator could not be loaded.');
    }
    process.stdout.write(JSON.stringify(await validateSubmission(JSON.parse(source.toString('utf8')))));
    return;
  }
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun && !process.argv.includes('--publish')) {
    process.stdout.write('Usage: node scripts/github-academy.mjs --dry-run --issues-file fixture.json [--data-dir checkout]\n       node scripts/github-academy.mjs --publish --data-dir academy-data-checkout\nDry runs use a temporary in-memory signing key unless ACADEMY_SIGNING_KEY is supplied. They never write files, contact GitHub, or issue real certificates.\n');
    return;
  }
  const repository = process.env.GITHUB_REPOSITORY;
  if (!dryRun && (process.env.GITHUB_ACTIONS !== 'true' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(repository ?? '') ||
      !process.env.GITHUB_TOKEN || !process.env.ACADEMY_SIGNING_KEY))
    throw new Error('Publishing requires GitHub Actions, its repository token, and the provisioned issuer key.');
  const signer = makeSigner(process.env.ACADEMY_SIGNING_KEY
    ? JSON.parse(process.env.ACADEMY_SIGNING_KEY)
    : generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' }));
  const directory = option('--data-dir') ? resolve(option('--data-dir')) : null;
  if (!dryRun) {
    const configured = JSON.parse(readFileSync(resolve(ROOT, 'lib/github/public-key.json'), 'utf8'));
    const publicJwk = configured.publicKey ?? configured.jwk ?? configured;
    if (publicJwk.kty !== signer.publicJwk.kty || publicJwk.crv !== signer.publicJwk.crv ||
        publicJwk.x !== signer.publicJwk.x || publicJwk.y !== signer.publicJwk.y)
      throw new Error('The signing key does not match the public key published with the application.');
    if (!directory || directory === resolve(ROOT) ||
        git(directory, ['branch', '--show-current']) !== 'academy-data' ||
        git(directory, ['status', '--porcelain']) !== '')
      throw new Error('Publishing requires a clean, separate academy-data branch checkout.');
    const remote = git(directory, ['remote', 'get-url', 'origin']);
    if (remote !== `https://github.com/${repository}` && remote !== `https://github.com/${repository}.git`)
      throw new Error('Unexpected academy-data remote.');
  }
  const store = makeStore(signer, directory, dryRun);
  const batchSize = 50;
  const deadline = Date.now() + 6 * 60_000;
  let issues = [];
  let api;
  if (dryRun) {
    if (!option('--issues-file')) throw new Error('Dry run requires a local --issues-file fixture.');
    const bytes = readFileSync(resolve(option('--issues-file')));
    if (bytes.length > MAX_FILE_BYTES) throw new Error('Fixture exceeds limit.');
    issues = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(issues) || issues.length > batchSize) throw new Error('A fixture can contain at most 50 issues.');
  } else {
    api = githubApi(repository, process.env.GITHUB_TOKEN);
    // The event is only a hint. Re-fetch the issue from GitHub to establish its
    // author and current body, and always reconcile the durable open-issue queue.
    if (process.env.GITHUB_EVENT_PATH) {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      if (Number.isSafeInteger(event.issue?.number) && event.issue.number > 0)
        issues.push(await api(`/repos/${repository}/issues/${event.issue.number}`));
    }
    const scan = store.read('state/scan.json');
    let page = Number.isInteger(scan?.nextPage) && scan.nextPage > 0 && scan.nextPage <= 100_000 ? scan.nextPage : 1;
    for (let scanned = 0; scanned < 6; scanned++) {
      const listed = await api(`/repos/${repository}/issues?state=open&sort=created&direction=asc&per_page=100&page=${page}`);
      issues.push(...listed.filter((issue) => !issue.pull_request && issue.body?.includes(MARKER)));
      if (listed.length < 100) { page = 1; break; }
      page++;
      if (issues.length >= batchSize) break;
    }
    store.write('state/scan.json', { schema: 1, nextPage: page });
  }
  const unique = [...new Map(issues.map((issue) => [issue.number, issue])).values()];
  const outcomes = [];
  for (const issue of unique.slice(0, batchSize)) {
    if (Date.now() >= deadline) break;
    const outcome = await processIssue({ issue, store, validateSubmission: validateInChild });
    if (outcome) outcomes.push(outcome);
  }
  if ([...store.overlay.keys()].some((path) => path.startsWith('accounts/')) || !store.read('directory/index.json'))
    publishDirectory(store);
  if (!dryRun && store.overlay.size) {
    const paths = [...store.overlay.keys()];
    git(directory, ['add', '--', ...paths]);
    if (git(directory, ['diff', '--cached', '--name-only'])) {
      git(directory, ['-c', 'user.name=RCJ Academy', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit', '-m', `Publish ${outcomes.length} public mock academy request results`]);
      git(directory, ['push', 'origin', 'HEAD:refs/heads/academy-data'], true);
    }
  }
  // A crash/throttle here is harmless: committed issue ledgers make the next run
  // acknowledge the same results without reissuing a certificate.
  if (!dryRun) {
    for (const outcome of outcomes) {
      if (Date.now() >= deadline + 2 * 60_000) break;
      await acknowledge(api, repository, outcome);
    }
  }
  process.stdout.write(`${JSON.stringify({ dryRun, processed: outcomes.length,
    accepted: outcomes.filter((item) => item.status === 'accepted').length,
    rejected: outcomes.filter((item) => item.status === 'rejected').length,
    changedRecords: store.overlay.size })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  main().catch((error) => {
    // Never log raw submissions, validator stacks, private keys, or API responses.
    process.stderr.write('Mock academy processing failed. No uncommitted results were acknowledged; pending issues will be retried. Check issuer configuration, resource limits, and GitHub availability.\n');
    process.exitCode = error instanceof RetryableValidationError ? 2 : 1;
  });
}
