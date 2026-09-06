import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const accountProviderUrl = new URL(
  'components/account/AccountProvider.tsx',
  root,
).href;

// Render the actual presentation components with controlled account snapshots;
// do not involve browser storage, cryptography or the GitHub network in UI tests.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let target;
    if (specifier.startsWith('@/')) target = new URL(specifier.slice(2), root);
    else if (
      /^\.\.?\//.test(specifier) &&
      context.parentURL?.startsWith(root.href) &&
      !context.parentURL.includes('/node_modules/')
    )
      target = new URL(specifier, context.parentURL);
    if (target) {
      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
        const candidate = new URL(`${target.href}${suffix}`);
        if (existsSync(candidate)) return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === accountProviderUrl)
      return {
        format: 'module',
        shortCircuit: true,
        source:
          'export function useAccount() { return globalThis.__rcjAccountUiTest; }',
      };
    if (url.startsWith(root.href) && !url.includes('/node_modules/')) {
      if (url.endsWith('.json'))
        return {
          format: 'module',
          shortCircuit: true,
          source: `export default ${readFileSync(new URL(url), 'utf8')}`,
        };
      if (/\.tsx?$/.test(url))
        return {
          format: 'module',
          shortCircuit: true,
          source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
              jsx: ts.JsxEmit.ReactJSX,
            },
          }).outputText,
        };
    }
    return nextLoad(url, context);
  },
});

const { AccountAccessCard, CertificationStatusBadge } =
  await import('../components/account/account-ui.tsx');
const { CertificationPanel } =
  await import('../components/account/CertificationPanel.tsx');
const { GitHubSubmissionPanel } =
  await import('../components/account/GitHubSubmissionPanel.tsx');
const { ProfilePanel } = await import('../components/account/ProfilePanel.tsx');
const { AcademyHub } = await import('../components/account/AcademyHub.tsx');
const { CERTIFICATION_POLICY } = await import('../lib/certification/policy.ts');

const noop = () => {};
const timestamp = '2026-09-06T12:00:00.000Z';
const request = {
  kind: 'certify',
  requestId: 'a'.repeat(32),
  body: 'RCJ-ACADEMY-V1:public-evidence',
  issueUrl: 'https://github.com/JakubGal/rcj-soccer-lab/issues/new',
};
const receipt = {
  ...request,
  status: 'accepted',
  githubId: 42,
  githubLogin: 'training-alias',
  refereeNumber: 'RCJ-2026-42',
  issueNumber: 17,
  message: 'Verified.',
  certificate: { roundId: 'round-1' },
};

function mockContext({
  roundStatus = 'ready',
  github = {},
  status = 'authenticated',
} = {}) {
  const track = (mode) => ({
    mode,
    requiredGames: mode === 'step' ? 5 : 2,
    qualifyingGames: mode === 'step' ? 5 : 2,
    attemptsUsed: mode === 'step' ? 5 : 2,
    attemptsAllowed: mode === 'step' ? 8 : 5,
    requiredAccuracy: mode === 'step' ? 90 : 80,
    durationSeconds: 600,
    passed: true,
    attempts: [],
  });
  return {
    status,
    error: null,
    busyAction: null,
    account: {
      authenticated: true,
      profile: {
        id: 'local',
        email: '',
        displayName: 'Training Alias',
        country: 'Slovakia',
        refereeNumber: '',
        publicProfile: true,
        createdAt: timestamp,
      },
      practice: {
        ruleChecksCompleted: 0,
        ruleChecksTotal: CERTIFICATION_POLICY.ruleQuestionCount,
        refereeGamesPlayed: 0,
        stepGamesPlayed: 0,
        continuousGamesPlayed: 0,
        stepAccuracy: null,
        continuousAccuracy: null,
        completedQuestionIds: [],
      },
      certification: {
        id: 'round-1',
        number: 1,
        season: '2026',
        status: roundStatus,
        policyVersion: CERTIFICATION_POLICY.policyVersion,
        startedAt: timestamp,
        completedAt: null,
        rules: {
          total: CERTIFICATION_POLICY.ruleQuestionCount,
          answered: CERTIFICATION_POLICY.ruleQuestionCount,
          correctFirstTry: CERTIFICATION_POLICY.ruleFirstTryRequired,
          accuracy:
            (100 * CERTIFICATION_POLICY.ruleFirstTryRequired) /
            CERTIFICATION_POLICY.ruleQuestionCount,
          requiredAccuracy: 95,
          passed: true,
          answeredQuestionIds: [],
        },
        step: track('step'),
        continuous: track('continuous'),
      },
      recentGames: [],
      certificationHistory: [],
      links: { signIn: null, signOut: null },
    },
    github: { request: null, receipt: null, connected: false, ...github },
    signIn: noop,
    signOut: noop,
    updateProfile: noop,
    beginCertification: noop,
    resetCertification: noop,
    beginCertificationGame: noop,
    prepareGitHubSubmission: noop,
    checkGitHubSubmission: noop,
    exportProgress: noop,
    importProgress: noop,
  };
}

function render(Component, props = {}, context = mockContext()) {
  globalThis.__rcjAccountUiTest = context;
  return renderToStaticMarkup(createElement(Component, props));
}

test('guest entry describes a local profile without requesting remote credentials', () => {
  const html = render(AccountAccessCard);
  assert.match(html, /Create local profile/);
  assert.match(html, /without a password/);
  assert.match(html, /does not sync between devices/);
  assert.doesNotMatch(html, /chatgpt|secure site|Sign in or create account/i);
});

test('ready badge is never an issued training certification badge', () => {
  const html = render(CertificationStatusBadge, { status: 'ready' });
  assert.match(html, /Ready for verification/);
  assert.doesNotMatch(html, /Training certified/);
});

test('completed local requirements are ready, not already certified', () => {
  const html = render(CertificationPanel);
  assert.match(html, /Ready for verification/);
  assert.match(html, /complete locally/);
  assert.match(html, /Submit for verification/);
  assert.doesNotMatch(
    html,
    /Your training certificate has a verified|Training certification verified/,
  );
});

test('an old accepted submission cannot label a new unverified round certified', () => {
  const html = render(
    GitHubSubmissionPanel,
    { kind: 'certify' },
    mockContext({ github: { receipt, request } }),
  );
  assert.doesNotMatch(html, /Training certification verified/);
  assert.match(html, /Your submission will be public/);
});

test('pending certification clearly requires copying, creating the issue, and checking', () => {
  const html = render(
    GitHubSubmissionPanel,
    { kind: 'certify' },
    mockContext({ github: { request } }),
  );
  assert.match(html, /Copy submission/);
  assert.match(html, /Open GitHub issue/);
  assert.match(html, /Check verification result/);
  assert.match(html, /does not submit it for you/);
  assert.match(html, /public-evidence/);
  assert.doesNotMatch(html, /Training certification verified/);
});

test('rejected result exposes the reason and permits another prepared submission', () => {
  const html = render(
    GitHubSubmissionPanel,
    { kind: 'certify' },
    mockContext({
      github: {
        request,
        receipt: {
          ...receipt,
          status: 'rejected',
          message: 'Two qualifying continuous games are required.',
        },
      },
    }),
  );
  assert.match(html, /Submission not accepted/);
  assert.match(html, /Two qualifying continuous games are required/);
  assert.match(html, /Prepare certification submission/);
  assert.doesNotMatch(html, /Training certification verified/);
});

test('verified result identifies it as training rather than an official appointment', () => {
  const html = render(
    GitHubSubmissionPanel,
    { kind: 'certify' },
    mockContext({
      roundStatus: 'qualified',
      github: { request, receipt, connected: true },
    }),
  );
  assert.match(html, /Training certification verified/);
  assert.match(html, /not an official competition appointment/);
  assert.match(html, /issues\/17/);
  assert.doesNotMatch(html, /Prepare certification submission/);
});

test('a subsequent profile update does not hide an existing verified certificate', () => {
  const html = render(
    GitHubSubmissionPanel,
    { kind: 'certify' },
    mockContext({
      roundStatus: 'qualified',
      github: {
        connected: true,
        receipt: { ...receipt, kind: 'connect' },
        request: { ...request, kind: 'connect' },
      },
    }),
  );
  assert.match(html, /Training certification verified/);
  assert.doesNotMatch(html, /Prepare certification submission/);
});

test('connected identities can update public profile and directory preference', () => {
  const html = render(
    GitHubSubmissionPanel,
    { kind: 'connect' },
    mockContext({ github: { connected: true } }),
  );
  assert.match(html, /GitHub identity verified/);
  assert.match(html, /Update public GitHub profile/);
  assert.match(html, /Earlier issues remain public/);
});

test('pending profile updates remain actionable while the old identity is connected', () => {
  const html = render(
    GitHubSubmissionPanel,
    { kind: 'connect' },
    mockContext({
      github: { connected: true, request: { ...request, kind: 'connect' } },
    }),
  );
  assert.match(html, /Check verification result/);
  assert.doesNotMatch(html, /Update public GitHub profile/);
});

test('profile explicitly offers private-device backup and distinguishes readiness', () => {
  const html = render(ProfilePanel);
  assert.match(html, /Export progress backup/);
  assert.match(html, /Import progress backup/);
  assert.match(html, /replaces this browser/);
  assert.match(html, /not synced to an account online/);
  assert.match(html, /Ready for verification/);
  assert.doesNotMatch(html, /Training certified/);
});

test('academy headline never promotes local completion to certification', () => {
  const html = render(AcademyHub);
  assert.match(html, /Local profile/);
  assert.doesNotMatch(html, /Training certified|Signed in as|chatgpt/i);
});

test('step recordings are labelled Review summary while continuous recordings say Review game', () => {
  for (const mode of ['step', 'continuous']) {
    const context = mockContext();
    const game = {
      id: 'recorded-game',
      mode,
      attemptNumber: 1,
      durationSeconds: 600,
      accuracy: 90,
      completed: true,
      qualifying: true,
      startedAt: timestamp,
      completedAt: timestamp,
      canReview: true,
    };
    context.account.certification[mode].attempts = [game];
    context.account.recentGames = [game];
    const expected = mode === 'step' ? />Review summary</ : />Review game</;
    const unwanted = mode === 'step' ? />Review game</ : />Review summary</;
    for (const component of [CertificationPanel, ProfilePanel]) {
      const html = render(component, { onReviewGame: noop }, context);
      assert.match(html, expected);
      assert.doesNotMatch(html, unwanted);
    }
  }
});

test('a verified older round retains its certificate notice but cannot submit for the new examination', () => {
  const context = mockContext({
    roundStatus: 'qualified',
    github: { request, receipt, connected: true },
  });
  context.account.certification.policyVersion = 'rcj-soccer-2026-v1';
  const html = render(CertificationPanel, {}, context);
  assert.match(html, /Training certification verified/);
  assert.match(html, /Updated examination available/);
  assert.match(html, /signed certificate are preserved/);
  assert.doesNotMatch(
    html,
    /Prepare certification submission|Submit for verification/,
  );
});
