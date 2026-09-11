import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import translations from './committee-translations.mjs';

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

const normalize = (text) => text.trim().replace(/\s+/g, ' ');
const uiSource = ts.createSourceFile(
  'CommitteeCompanions.tsx',
  readFileSync(
    new URL('../components/committee/CommitteeCompanions.tsx', import.meta.url),
    'utf8',
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const uiCopy = new Set([
  'Celebrate',
  'Explain',
  'Encourage',
  'Let’s play',
  'Next',
]);
function collectUi(node) {
  if (
    ts.isPropertyAssignment(node) &&
    ['title', 'text', 'hint'].includes(node.name.getText(uiSource)) &&
    ts.isStringLiteral(node.initializer)
  )
    uiCopy.add(normalize(node.initializer.text));
  if (ts.isJsxText(node) && /\p{L}/u.test(node.text))
    uiCopy.add(normalize(node.text));
  if (
    ts.isJsxAttribute(node) &&
    node.name.getText(uiSource) === 'aria-label' &&
    node.initializer &&
    ts.isStringLiteral(node.initializer)
  )
    uiCopy.add(normalize(node.initializer.text));
  ts.forEachChild(node, collectUi);
}
collectUi(uiSource);

test('reviewed committee translations cover every cast line and current tour control', () => {
  const copy = new Set([
    COMMITTEE_VOICE_DISCLAIMER,
    ...CHARACTERS.flatMap((character) => [character.role, character.bio]),
    ...DIALOGUE.map((line) => line.text),
    ...uiCopy,
  ]);
  assert.ok(DIALOGUE.length >= 120);
  assert.ok(uiCopy.size >= 40);
  assert.deepEqual(Object.keys(translations), ['sk', 'de', 'ja']);
  for (const [locale, dictionary] of Object.entries(translations)) {
    assert.deepEqual(
      new Set(Object.keys(dictionary)),
      copy,
      `${locale}: stale or missing source keys`,
    );
    for (const source of copy) {
      const translated = dictionary[source];
      assert.ok(translated?.trim(), `${locale}:${source}`);
      assert.doesNotMatch(
        translated,
        /\uFFFD|https?:\/\/|<\/?[a-z]/i,
        `${locale}:${source}`,
      );
      if (source !== 'RCJ Soccer Lab')
        assert.notEqual(translated, source, `${locale}:${source}`);
    }
  }
});

test('committee translations retain names, rule terms, brands and keyboard labels', () => {
  const preserved =
    /\b(?:Out of bounds|out of bounds|Damaged|damaged|pushed out|kickoff|Kickoff|Dribbler|RoboFuse|Slido|Vim|git blame|JP Morgan|IR|ESP|OLED|Jakub|Caroline|RefMate|RCJ|WASD|Space|Enter|ROI)\b/g;
  for (const [locale, dictionary] of Object.entries(translations)) {
    for (const [source, translated] of Object.entries(dictionary)) {
      for (const term of new Set(source.match(preserved) ?? []))
        assert.ok(
          translated.includes(term),
          `${locale}: missing ${term}: ${source}`,
        );
    }
  }
});

test('neutral recorded comments do not acquire verdicts in translation', () => {
  const verdict = {
    sk: /správn(?:e|y|a|á|o)|nesprávn|chybn|pomýl|certifikovan/i,
    de: /\b(?:richtig|falsch|Fehler|zertifiziert)\b/i,
    ja: /正解|不正解|間違い|誤り|認定され|合格/,
  };
  for (const line of DIALOGUE.filter((entry) =>
    entry.outcomes.includes('recorded'),
  )) {
    for (const locale of ['sk', 'de', 'ja'])
      assert.doesNotMatch(
        translations[locale][line.text],
        verdict[locale],
        `${locale}:${line.id}`,
      );
  }
});

test('each character can respond to correct general questions without relying on an event topic', () => {
  for (const character of CHARACTERS) {
    const line = DIALOGUE.find(
      (entry) =>
        entry.character === character.id &&
        entry.topic === 'general' &&
        entry.outcomes.includes('correct'),
    );
    assert.ok(line, character.id);
    assert.equal(line.pose, 'celebrate', character.id);
    for (const dictionary of Object.values(translations))
      assert.ok(dictionary[line.text]);
  }
});

test('the shipped runtime catalogue uses the reviewed committee translations', () => {
  const runtime = JSON.parse(
    readFileSync(
      new URL('../lib/i18n/catalog.generated.json', import.meta.url),
      'utf8',
    ),
  );
  for (const [locale, dictionary] of Object.entries(translations)) {
    for (const [source, reviewed] of Object.entries(dictionary))
      assert.equal(
        runtime.locales[locale].exact[source],
        reviewed,
        `${locale}:${source}`,
      );
  }
});
