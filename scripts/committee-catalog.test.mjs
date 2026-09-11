import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.ts') && url.includes('/lib/committee/'))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
      };
    return nextLoad(url, context);
  },
});

const { CHARACTERS, DIALOGUE, COMMITTEE_VOICE_DISCLAIMER } =
  await import('../lib/committee/catalog.ts');

const ids = [
  'marek',
  'isa',
  'tom',
  'will',
  'finance',
  'david',
  'jakub',
  'caroline',
];
const topics = new Set([
  'out',
  'damaged',
  'goal',
  'own-goal',
  'pushed-out',
  'restart',
  'technical',
  'interference',
  'progress',
  'general',
]);
const outcomes = new Set(['correct', 'retry', 'recorded', 'study', 'complete']);
const poses = new Set(['celebrate', 'explain', 'encourage']);

test('the committee cast has eight stable identities and safe local image paths', () => {
  assert.deepEqual(
    CHARACTERS.map((character) => character.id),
    ids,
  );
  assert.equal(
    new Set(CHARACTERS.map((character) => character.name)).size,
    ids.length,
  );
  assert.equal(
    CHARACTERS.find((character) => character.id === 'finance').name,
    'Roberto',
  );
  for (const character of CHARACTERS) {
    assert.equal(character.asset, `/characters/${character.id}.png`);
    assert.match(character.accent, /^#[0-9a-f]{6}$/i);
    for (const field of ['name', 'role', 'bio']) {
      assert.ok(character[field].trim(), `${character.id}:${field}`);
      assert.doesNotMatch(character[field], /\uFFFD|name pending|placeholder/i);
    }
  }
  assert.match(COMMITTEE_VOICE_DISCLAIMER, /fictional/i);
  assert.match(COMMITTEE_VOICE_DISCLAIMER, /not real quotations/i);
  assert.match(COMMITTEE_VOICE_DISCLAIMER, /sourced feedback.*authoritative/i);
});

test('each character has at least twelve distinct compact lines and covers every topic', () => {
  assert.ok(DIALOGUE.length >= 96);
  assert.equal(
    new Set(DIALOGUE.map((entry) => entry.id)).size,
    DIALOGUE.length,
  );
  assert.equal(
    new Set(DIALOGUE.map((entry) => entry.text)).size,
    DIALOGUE.length,
  );
  for (const id of ids) {
    const lines = DIALOGUE.filter((entry) => entry.character === id);
    assert.ok(lines.length >= 12, id);
    assert.deepEqual(new Set(lines.map((entry) => entry.topic)), topics, id);
    assert.deepEqual(
      new Set(lines.flatMap((entry) => entry.outcomes)),
      outcomes,
      id,
    );
    assert.deepEqual(new Set(lines.map((entry) => entry.pose)), poses, id);
  }
  for (const entry of DIALOGUE) {
    assert.ok(ids.includes(entry.character), entry.id);
    assert.match(entry.id, new RegExp(`^${entry.character}-[a-z0-9-]+$`));
    assert.ok(topics.has(entry.topic), entry.id);
    assert.ok(poses.has(entry.pose), entry.id);
    assert.ok(entry.outcomes.length > 0, entry.id);
    assert.equal(new Set(entry.outcomes).size, entry.outcomes.length, entry.id);
    for (const outcome of entry.outcomes)
      assert.ok(outcomes.has(outcome), entry.id);
    assert.ok(
      entry.text.trim().length >= 15 && entry.text.length <= 150,
      entry.id,
    );
    assert.doesNotMatch(entry.text, /\uFFFD|https?:\/\/|<\/?[a-z]/i, entry.id);
  }
});

test('every character has multiple topic-neutral recorded lines without hidden verdicts', () => {
  for (const id of ids) {
    const recorded = DIALOGUE.filter(
      (entry) => entry.character === id && entry.outcomes.includes('recorded'),
    );
    assert.ok(recorded.length >= 2, id);
    for (const entry of recorded) {
      assert.equal(entry.topic, 'general', entry.id);
      assert.deepEqual(entry.outcomes, ['recorded'], entry.id);
      assert.notEqual(entry.pose, 'celebrate', entry.id);
      assert.match(entry.text, /recorded|logged|log|saved/i, entry.id);
      assert.doesNotMatch(
        entry.text,
        /\b(correct|incorrect|wrong|right|mistake|missed|should|goal|out of bounds|damaged|pushed out|kickoff)\b/i,
        entry.id,
      );
    }
  }
});

test('recorded dialogue stays separate from coaching and factual rule explanations', () => {
  for (const entry of DIALOGUE) {
    if (entry.outcomes.includes('retry'))
      assert.notEqual(entry.pose, 'celebrate', entry.id);
    // These comments supplement the rule engine; they never claim authority or
    // insert a penalty duration, boundary condition, or certification award.
    assert.doesNotMatch(
      entry.text,
      /\byou (?:are|became) certified\b|\brule \d|\b60[- ]second|\bone[- ]minute penalty|\bcross(?:ing|ed)? the white line\b/i,
      entry.id,
    );
    if (entry.character === 'finance')
      assert.doesNotMatch(
        entry.text,
        /[€$£]\s*\d|guaranteed (?:return|profit)/i,
        entry.id,
      );
  }
});

test('every shipped character has a full-resolution three-pose PNG and a recorded prompt', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL('../docs/committee-artwork-prompts.json', import.meta.url),
      'utf8',
    ),
  );
  const serialized = JSON.stringify(manifest);
  for (const character of CHARACTERS) {
    const file = readFileSync(
      new URL(`../public${character.asset}`, import.meta.url),
    );
    assert.equal(
      file.subarray(0, 8).toString('hex'),
      '89504e470d0a1a0a',
      character.id,
    );
    assert.equal(file.readUInt32BE(16), 1536, character.id);
    assert.equal(file.readUInt32BE(20), 1024, character.id);
    assert.ok(file.length > 100000, character.id);
    assert.ok(serialized.includes(character.asset.slice(1)), character.id);
  }
});
