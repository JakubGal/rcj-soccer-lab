import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  registerTrustedTypes,
  decodeSubmission,
  makeSigner,
} from './github-academy.mjs';
import { generateKeyPairSync } from 'node:crypto';
registerTrustedTypes();
const { prepareSubmission } = await import('../lib/github/protocol.ts');
const { verifyEnvelope } = await import('../lib/github/registry.ts');
const { summarizeRuleEvidence, validateSubmission } =
  await import('../lib/github/validate.ts');
const { certificationSeed } = await import('../lib/github/seeds.ts');
const {
  emptyProgress,
  enableProfile,
  newRound,
  startLocalGame,
  accountSnapshot,
  validateBackup,
  acceptGitHubReceipt,
  assertCanPrepareGitHubRequest,
} = await import('../lib/account/local.ts');
const { RULE_CLIPS } = await import('../lib/rulebook/animations.ts');
const { SCENARIOS } = await import('../lib/simulator/scenarios.ts');
const { REFEREE_CASES } = await import('../lib/simulator/referee-cases.ts');
const { LEARNING_SITUATIONS } = await import('../lib/rulebook/learning.ts');

const profile = {
  displayName: 'Test alias',
  country: '',
  publicProfile: false,
};
const newData = async () => {
  const data = emptyProgress();
  enableProfile(data);
  await newRound(data);
  return data;
};
function eventFor(id, roundId, override) {
  const [kind, sourceId] = id.split(':');
  let answer;
  if (kind === 'clip')
    answer = {
      kind,
      selectedIndex: RULE_CLIPS.find((item) => item.id === sourceId).answer,
    };
  if (kind === 'scenario')
    answer = {
      kind,
      choiceId: SCENARIOS.find((item) => item.id === sourceId).choices.find(
        (item) => ['correct', 'acceptable'].includes(item.grade),
      ).id,
    };
  if (kind === 'case')
    answer = {
      kind,
      calls: REFEREE_CASES.find((item) => item.id === sourceId).steps.map(
        (step) => ({ ...step[0] }),
      ),
    };
  return {
    type: 'complete',
    mode: 'certification',
    certificationRunId: roundId,
    questionId: id,
    sourceId,
    kind,
    decisionId: id,
    answer,
    firstTryCorrect: true,
    assisted: false,
    ...override,
  };
}

test('browser compressed submission round-trips through the real issue decoder', async () => {
  const payload = {
    schema: 1,
    kind: 'connect',
    requestId: 'f'.repeat(32),
    profile,
  };
  const request = await prepareSubmission(payload);
  assert.deepEqual(decodeSubmission(request.body), payload);
  assert.equal(new URL(request.issueUrl).hostname, 'github.com');
  assert.equal(
    (await validateSubmission(payload)).profile.displayName,
    profile.displayName,
  );
});
test('public connection validation rejects executable/control text and malformed payloads', async () => {
  for (const malformed of [
    null,
    {},
    {
      schema: 1,
      kind: 'connect',
      requestId: 'f'.repeat(32),
      profile: { ...profile, displayName: 'x\nrun code' },
    },
    { schema: 1, kind: 'connect', requestId: 'not-an-id', profile },
  ])
    await assert.rejects(() => validateSubmission(malformed));
});
test('all canonical rule answers grade correctly; later answers cannot repair first mistakes', async () => {
  const data = await newData();
  const events = LEARNING_SITUATIONS.map((item) =>
    eventFor(item.id, data.round.id),
  );
  assert.equal(
    summarizeRuleEvidence(events, data.round.id).correctFirstTry,
    73,
  );
  const clip = events.find((item) => item.kind === 'clip');
  const wrong = {
    ...clip,
    answer: {
      kind: 'clip',
      selectedIndex: clip.answer.selectedIndex === 0 ? 1 : 0,
    },
  };
  const result = summarizeRuleEvidence([wrong, ...events], data.round.id);
  assert.equal(result.correctFirstTry, 72);
  assert.equal(result.answered, 73);
  const helped = { ...clip, type: 'assistance', assistance: 'hint' };
  assert.equal(
    summarizeRuleEvidence([helped, ...events], data.round.id).correctFirstTry,
    72,
  );
  assert.throws(() => summarizeRuleEvidence(events, 'different-round'));
});
test('first case steps remain immutable when later complete prefixes replace them', async () => {
  const data = await newData();
  const definition = LEARNING_SITUATIONS.find((item) =>
    item.id.startsWith('case:'),
  );
  const correct = eventFor(definition.id, data.round.id);
  const wrongCall = {
    action: correct.answer.calls[0].action === 'goal' ? 'out' : 'goal',
    target: 'yellow-1',
  };
  // Both are known referee actions but the initial choice is intentionally wrong.
  const wrong = {
    ...correct,
    type: 'answer',
    answer: { kind: 'case', calls: [wrongCall] },
  };
  const result = summarizeRuleEvidence([wrong, correct], data.round.id);
  assert.equal(result.correctFirstTry, 0);
  assert.equal(result.answered, 1);
});
test('attempt seeds are bound to round, mode and attempt index; starts consume attempts', async () => {
  const data = await newData();
  const launch = await startLocalGame(data, {
    mode: 'step',
    roundId: data.round.id,
  });
  assert.equal(launch.seed, await certificationSeed(data.round.id, 'step', 1));
  assert.notEqual(
    launch.seed,
    await certificationSeed(data.round.id, 'step', 2),
  );
  assert.notEqual(
    launch.seed,
    await certificationSeed(data.round.id, 'continuous', 1),
  );
  assert.equal(
    (await accountSnapshot(data)).certification.step.attemptsUsed,
    1,
  );
  await assert.rejects(() =>
    startLocalGame(data, { mode: 'step', roundId: 'old-round' }),
  );
});
test('editing local totals or a signed receipt cannot grant issuer-verified certification', async () => {
  const data = await newData();
  data.round.ruleEvents = LEARNING_SITUATIONS.map((item) =>
    eventFor(item.id, data.round.id),
  );
  for (const mode of ['step', 'continuous'])
    for (let i = 0; i < (mode === 'step' ? 5 : 2); i++) {
      const id = crypto.randomUUID();
      data.round.games.push({
        id,
        mode,
        seed: i,
        startedAt: data.round.startedAt,
      });
      data.attempts[id] = {
        id,
        mode,
        qualifying: true,
        completed: true,
        accuracy: 100,
      };
    }
  assert.equal((await accountSnapshot(data)).certification.status, 'ready');
  const fakeSigner = makeSigner(
    generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
      format: 'jwk',
    }),
  );
  data.certificationReceipt = fakeSigner.envelope({
    status: 'accepted',
    certificate: { roundId: data.round.id },
  });
  await assert.rejects(() => verifyEnvelope(data.certificationReceipt));
  assert.equal((await accountSnapshot(data)).certification.status, 'ready');
  await assert.rejects(() => validateBackup(data), /signature/);
  await assert.rejects(() =>
    validateSubmission({
      schema: 1,
      kind: 'certify',
      requestId: 'a'.repeat(32),
      profile,
      round: data.round,
    }),
  );
});
test('full restart clears exam evidence, attempts and pending results but keeps practice', async () => {
  const data = await newData();
  data.completedQuestions = ['clip:example'];
  data.practiceGames = [
    {
      id: 'practice',
      mode: 'step',
      durationSeconds: 60,
      accuracy: 80,
      completedAt: new Date().toISOString(),
    },
  ];
  data.request = {
    kind: 'certify',
    requestId: 'e'.repeat(32),
    issueUrl: 'https://github.com/',
    body: 'old',
  };
  const old = data.round.id;
  await startLocalGame(data, { mode: 'step', roundId: old });
  await newRound(data);
  assert.notEqual(data.round.id, old);
  assert.equal(data.round.number, 2);
  assert.equal(data.round.games.length, 0);
  assert.equal(data.round.ruleEvents.length, 0);
  assert.equal(data.request, null);
  assert.equal(data.certificationReceipt, null);
  assert.equal(data.practiceGames.length, 1);
  assert.equal(data.history[0].id, old);
});
test('import strips arbitrary outgoing links and keeps valid device-local progress', async () => {
  const data = await newData();
  data.request = {
    kind: 'connect',
    requestId: 'f'.repeat(32),
    issueUrl: 'https://attacker.invalid',
    body: 'untrusted',
  };
  const restored = await validateBackup(JSON.parse(JSON.stringify(data)));
  assert.equal(restored.request.requestId, data.request.requestId);
  assert.equal(new URL(restored.request.issueUrl).origin, 'https://github.com');
  assert.doesNotMatch(restored.request.issueUrl, /attacker/);
  assert.doesNotMatch(restored.request.body, /untrusted/);
  assert.equal(
    decodeSubmission(restored.request.body).requestId,
    data.request.requestId,
  );
  assert.equal(restored.round.id, data.round.id);
  assert.equal(
    (await accountSnapshot(restored)).certification.status,
    'in-progress',
  );
});

test('malformed nested backups are rejected before replacing device progress', async () => {
  const changes = [
    (data) => {
      data.history = [null];
    },
    (data) => {
      data.history = [
        {
          id: crypto.randomUUID(),
          roundNumber: 1,
          season: '2026',
          status: ['qualified'],
          startedAt: null,
          completedAt: null,
        },
      ];
    },
    (data) => {
      data.profile.createdAt = {};
    },
    (data) => {
      data.profile.publicProfile = 'true';
    },
    (data) => {
      data.completedQuestions = [{}];
    },
    (data) => {
      data.practiceGames = [
        {
          id: 'game',
          mode: 'step',
          durationSeconds: 600,
          accuracy: 100,
          completedAt: 42,
        },
      ];
    },
    (data) => {
      data.round.startedAt = 'invalid date';
    },
    (data) => {
      data.attempts = {
        [crypto.randomUUID()]: { id: 'unrelated', accuracy: 100 },
      };
    },
  ];
  for (const change of changes) {
    const data = await newData();
    change(data);
    await assert.rejects(() => validateBackup(data));
  }
});

test('unsigned historic qualification is downgraded, including before import', async () => {
  const data = await newData();
  data.history = [
    {
      id: crypto.randomUUID(),
      roundNumber: 1,
      season: '2026',
      status: 'qualified',
      startedAt: null,
      completedAt: null,
    },
  ];
  assert.equal(
    (await accountSnapshot(data)).certificationHistory[0].status,
    'ready',
  );
  const restored = await validateBackup(data);
  assert.equal(restored.history[0].status, 'ready');
  assert.equal(
    (await accountSnapshot(restored)).certificationHistory[0].status,
    'ready',
  );
});

async function withTestIssuer(operation) {
  // Mutate only the module's in-memory public key for this isolated test process;
  // the checked-in issuer key and all files remain untouched.
  const configured = (await import('../lib/github/public-key.json')).default;
  const original = { ...configured };
  const signer = makeSigner(
    generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
      format: 'jwk',
    }),
  );
  Object.assign(configured, signer.publicJwk);
  try {
    await operation(signer);
  } finally {
    Object.assign(configured, original);
  }
}
function certifiedReceipt(data, kind = 'certify') {
  return {
    kind,
    requestId: data.request.requestId,
    status: 'accepted',
    githubId: 42,
    githubLogin: 'test-referee',
    refereeNumber: 'RCJ-GH-42',
    issueNumber: 17,
    message: 'Verified mock training.',
    certificate: {
      roundId: data.round.id,
      certifiedAt: new Date().toISOString(),
    },
  };
}

test('pending certification identity survives backup and its issued receipt is recoverable', async () => {
  await withTestIssuer(async (signer) => {
    const data = await newData();
    data.request = {
      kind: 'certify',
      requestId: 'b'.repeat(32),
      issueUrl: 'javascript:alert(1)',
      body: 'untrusted',
    };
    const result = signer.envelope(certifiedReceipt(data));
    const restored = await validateBackup(structuredClone(data));
    assert.equal(restored.request.requestId, data.request.requestId);
    assert.equal(
      new URL(restored.request.issueUrl).origin,
      'https://github.com',
    );
    await acceptGitHubReceipt(restored, result);
    assert.equal(
      (await accountSnapshot(restored)).certification.status,
      'qualified',
    );
  });
});

test('new profile connection can recover a certificate issued for the current round', async () => {
  await withTestIssuer(async (signer) => {
    const data = await newData();
    data.request = {
      kind: 'connect',
      requestId: 'b'.repeat(32),
      issueUrl: 'https://github.com/',
      body: 'connect',
    };
    await acceptGitHubReceipt(
      data,
      signer.envelope(certifiedReceipt(data, 'connect')),
    );
    assert.equal(
      (await accountSnapshot(data)).certification.status,
      'qualified',
    );
    const wrongRound = signer.envelope({
      ...certifiedReceipt(data, 'connect'),
      certificate: {
        roundId: crypto.randomUUID(),
        certifiedAt: new Date().toISOString(),
      },
    });
    const otherData = await newData();
    otherData.request = data.request;
    await acceptGitHubReceipt(otherData, wrongRound);
    assert.notEqual(
      (await accountSnapshot(otherData)).certification.status,
      'qualified',
    );
  });
});

test('changing request kind cannot discard unresolved certification correlation', async () => {
  await withTestIssuer(async (signer) => {
    const data = await newData();
    data.request = {
      kind: 'certify',
      requestId: 'b'.repeat(32),
      issueUrl: 'https://github.com/',
      body: 'certify',
    };
    await assert.rejects(
      () => assertCanPrepareGitHubRequest(data, 'connect'),
      /pending GitHub submission/,
    );
    assert.equal(data.request.requestId, 'b'.repeat(32));
    data.receipt = signer.envelope({
      ...certifiedReceipt(data),
      status: 'rejected',
    });
    await assertCanPrepareGitHubRequest(data, 'connect');
  });
});

test('restart retains verifiable historic certification and import preserves its proof', async () => {
  await withTestIssuer(async (signer) => {
    const data = await newData();
    data.request = {
      kind: 'certify',
      requestId: 'b'.repeat(32),
      issueUrl: 'https://github.com/',
      body: 'certify',
    };
    await acceptGitHubReceipt(data, signer.envelope(certifiedReceipt(data)));
    const certifiedRoundId = data.round.id;
    await newRound(data);
    assert.ok(data.historyReceipts[certifiedRoundId]);
    assert.equal(
      (await accountSnapshot(data)).certificationHistory[0].status,
      'qualified',
    );
    const restored = await validateBackup(structuredClone(data));
    assert.equal(
      (await accountSnapshot(restored)).certificationHistory[0].status,
      'qualified',
    );
    restored.history[0].id = crypto.randomUUID();
    await assert.rejects(
      () => validateBackup(restored),
      /historical certification proof/,
    );
  });
});

test('complete seven-game round survives browser compression, issue decoding and authoritative replay', async () => {
  const { makePerfectReplay } = await import('./replay-fixtures.mjs');
  const data = await newData();
  data.round.id = '10000000-0000-4000-8000-000000000001';
  data.round.ruleEvents = LEARNING_SITUATIONS.map((item) =>
    eventFor(item.id, data.round.id),
  );
  for (const mode of ['step', 'continuous'])
    for (let index = 0; index < (mode === 'step' ? 5 : 2); index++) {
      const seed = await certificationSeed(data.round.id, mode, index + 1);
      data.round.games.push({
        id: crypto.randomUUID(),
        mode,
        seed,
        startedAt: new Date().toISOString(),
        replay: makePerfectReplay(mode, seed),
      });
    }
  const request = await prepareSubmission({
    schema: 1,
    kind: 'certify',
    requestId: 'c'.repeat(32),
    profile,
    round: data.round,
  });
  assert.ok(request.body.length < 65536, `issue size ${request.body.length}`);
  const payload = decodeSubmission(request.body);
  const validated = await validateSubmission(payload);
  assert.equal(validated.summary.rulesCorrect, 73);
  assert.equal(validated.summary.stepQualifying, 5);
  assert.equal(validated.summary.continuousQualifying, 2);
  const fake = structuredClone(payload);
  fake.round.games[1].replay = fake.round.games[0].replay;
  await assert.rejects(() => validateSubmission(fake), /replay does not match/);
  const countersOnly = structuredClone(payload);
  countersOnly.round.games = countersOnly.round.games.map(
    ({ replay: _replay, ...game }) => ({
      ...game,
      report: { accuracy: 100, correct: 999 },
    }),
  );
  await assert.rejects(() => validateSubmission(countersOnly), /requirements/);
  console.log(
    `Seven-game certification issue: ${request.body.length} characters; ${JSON.stringify(payload).length} uncompressed bytes.`,
  );
  for (const mode of ['step', 'continuous'])
    for (
      let index = mode === 'step' ? 5 : 2;
      index < (mode === 'step' ? 8 : 5);
      index++
    ) {
      const seed = await certificationSeed(data.round.id, mode, index + 1);
      data.round.games.push({
        id: crypto.randomUUID(),
        mode,
        seed,
        startedAt: new Date().toISOString(),
        replay: makePerfectReplay(mode, seed, { requireQualifying: false }),
      });
    }
  const fullRequest = await prepareSubmission({
    schema: 1,
    kind: 'certify',
    requestId: 'd'.repeat(32),
    profile,
    round: data.round,
  });
  const full = await validateSubmission(decodeSubmission(fullRequest.body));
  assert.equal(full.summary.stepAttempts, 8);
  assert.equal(full.summary.continuousAttempts, 5);
  console.log(
    `Maximum 13-game round: ${fullRequest.body.length} issue characters.`,
  );
});
