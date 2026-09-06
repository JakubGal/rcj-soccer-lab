import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      /^\.\.?\//.test(specifier) &&
      context.parentURL?.includes('/lib/') &&
      !/\.(ts|json)$/.test(specifier)
    )
      return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json') && url.includes('/lib/'))
      return {
        format: 'module',
        shortCircuit: true,
        source: `export default ${readFileSync(new URL(url), 'utf8')}`,
      };
    if (url.endsWith('.ts') && url.includes('/lib/'))
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

const {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  appendLocaleToSearch,
  normalizeLocale,
  resolveLocale,
  safeReadLocale,
  safeWriteLocale,
  setLocaleInHref,
  translateText,
} = await import('../lib/i18n/index.ts');
const { INITIAL_NAVIGATION, navigationSearch, readNavigation } =
  await import('../lib/simulator/navigation.ts');
const { REFEREE_CASES, transformText } =
  await import('../lib/simulator/referee-cases.ts');
const { findSections } = await import('../lib/rulebook/catalog.ts');
const generated = JSON.parse(
  readFileSync(new URL('../lib/i18n/catalog.generated.json', import.meta.url)),
);

test('supports English, Slovak, German and Japanese in stable order', () => {
  assert.deepEqual([...SUPPORTED_LOCALES], ['en', 'sk', 'de', 'ja']);
  assert.equal(DEFAULT_LOCALE, 'en');
});

test('normalizes regional language tags and rejects unsupported languages', () => {
  assert.equal(normalizeLocale('EN-us'), 'en');
  assert.equal(normalizeLocale('sk-SK'), 'sk');
  assert.equal(normalizeLocale('de-AT'), 'de');
  assert.equal(normalizeLocale('ja-JP'), 'ja');
  assert.equal(normalizeLocale('cs-CZ'), null);
  assert.equal(normalizeLocale(null), null);
});

test('resolves explicit URL, stored preference, browser language, then English', () => {
  assert.equal(
    resolveLocale({
      search: '?lang=ja',
      stored: 'sk',
      browserLocales: ['de-DE'],
    }),
    'ja',
  );
  assert.equal(
    resolveLocale({ search: '', stored: 'sk', browserLocales: ['de-DE'] }),
    'sk',
  );
  assert.equal(
    resolveLocale({
      search: '',
      stored: null,
      browserLocales: ['fr-FR', 'de-AT'],
    }),
    'de',
  );
  assert.equal(
    resolveLocale({ search: '?lang=unsupported', stored: 'sk' }),
    'en',
  );
  assert.equal(
    resolveLocale({ search: '', stored: null, browserLocales: ['fr-FR'] }),
    'en',
  );
});

test('locale storage is isolated and failure-safe', () => {
  const values = new Map([['unrelated', 'keep']]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(safeWriteLocale(storage, 'de'), true);
  assert.equal(values.get(LOCALE_STORAGE_KEY), 'de');
  assert.equal(safeReadLocale(storage), 'de');
  assert.equal(values.get('unrelated'), 'keep');
  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.equal(safeReadLocale(blocked), null);
  assert.equal(safeWriteLocale(blocked, 'ja'), false);
});

test('changing language preserves an entire deep link', () => {
  const input =
    'https://jakubgal.github.io/rcj-soccer-lab/' +
    '?mode=rules&rule=soccer%3Ascoring&situation=clip%3Aown-goal' +
    '&robot=lab&embed=goal&custom=kept#frame-10';
  const url = new URL(setLocaleInHref(input, 'ja'));
  assert.equal(url.pathname, '/rcj-soccer-lab/');
  assert.equal(url.hash, '#frame-10');
  assert.equal(url.searchParams.get('lang'), 'ja');
  assert.equal(url.searchParams.get('custom'), 'kept');
  assert.equal(url.searchParams.getAll('lang').length, 1);
  assert.match(
    appendLocaleToSearch('?mode=rules&robot=lab', 'sk', { robot: 'xlc' }),
    /lang=sk/,
  );
});

test('canonical simulator navigation carries the selected locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const encoded = navigationSearch(INITIAL_NAVIGATION, 'lab', locale);
    const query = new URLSearchParams(encoded);
    assert.equal(query.get('lang'), locale);
    assert.equal(query.get('robot'), 'lab');
    assert.deepEqual(readNavigation(encoded), INITIAL_NAVIGATION);
  }
});

test('rule search accepts localized section titles without losing English aliases', () => {
  for (const locale of ['sk', 'de', 'ja']) {
    const localizedTitle = translateText('Dimensions of the field', locale);
    const results = findSections(localizedTitle, 'field', (value) =>
      translateText(value, locale),
    );
    assert.ok(
      results.some((section) => section.id === 'field:dimensions-of-the-field'),
      locale,
    );
  }
  assert.ok(
    findSections('Dimensions of the field', 'field').some(
      (section) => section.id === 'field:dimensions-of-the-field',
    ),
  );
});

test('generated catalogs have the same complete source keys and valid Unicode', () => {
  const locales = ['sk', 'de', 'ja'];
  const first = Object.keys(generated.locales.sk.exact).sort();
  assert.ok(first.length > 500);
  for (const locale of locales) {
    assert.deepEqual(
      Object.keys(generated.locales[locale].exact).sort(),
      first,
    );
    for (const [source, translated] of Object.entries(
      generated.locales[locale].exact,
    )) {
      assert.ok(translated.trim(), `${locale}: ${source}`);
      assert.doesNotMatch(translated, /\uFFFD/, `${locale}: ${source}`);
    }
  }
  assert.match(translateText('Rules', 'ja'), /[\u3040-\u30ff\u3400-\u9fff]/u);
  assert.notEqual(translateText('Rules', 'sk'), 'Rules');
  assert.notEqual(translateText('Rules', 'de'), 'Rules');
});

test('every translated template preserves each dynamic placeholder', () => {
  for (const [locale, translations] of Object.entries(generated.locales)) {
    for (const pattern of translations.patterns) {
      const placeholders = (value) =>
        [...value.matchAll(/\{(\d+)\}/g)]
          .map((match) => match[1])
          .sort((a, b) => a.localeCompare(b));
      assert.deepEqual(
        placeholders(pattern.translation),
        placeholders(pattern.source),
        `${locale}: ${pattern.source}`,
      );
    }
  }
});

test('official rule calls and exact quotations remain in English', () => {
  const calls = [
    'Out of bounds',
    'Lack of progress',
    'Multiple defense',
    'Pushing',
    'Damaged robot',
    'Holding',
    'Dribbler',
    'Neutral kick-off',
    'Play on',
    'No goal',
    'Early start',
    'Ball sent out',
    'AC RMS',
    'DC',
    'IR',
  ];
  for (const locale of ['sk', 'de', 'ja']) {
    for (const call of calls) assert.equal(translateText(call, locale), call);
    assert.equal(
      translateText('The line is part of the area.', locale),
      'The line is part of the area.',
    );
    const sentence = translateText(
      'Full entry is out of bounds. Remove the robot for one minute or until an earlier kickoff.',
      locale,
    );
    assert.match(sentence, /out of bounds/i);
    assert.match(sentence, /kick-?off/i);
  }
});

test('every swapped-team referee lesson has translated catalogue coverage', () => {
  for (const item of REFEREE_CASES) {
    for (const field of ['title', 'facts', 'before', 'explanation']) {
      if (!item[field]) continue;
      const swapped = transformText(item[field], {
        swap: true,
        reflect: false,
      });
      if (swapped === item[field]) continue;
      for (const locale of ['sk', 'de', 'ja'])
        assert.ok(
          Object.hasOwn(generated.locales[locale].exact, swapped),
          `${locale}:${item.id}.${field}`,
        );
    }
  }
});

test('robot identifiers stay stable inside translated referee evidence', () => {
  const blue = 'Blue 1 reaches the physical wall without being pushed there.';
  const yellow = transformText(blue, { swap: true, reflect: false });
  for (const locale of ['sk', 'de', 'ja']) {
    assert.match(translateText(blue, locale), /Blue 1/);
    assert.match(translateText(yellow, locale), /Yellow 1/);
  }
});

test('scoring action buttons use reviewed football wording', () => {
  assert.equal(translateText('Award goal', 'sk'), 'Uznať gól');
  assert.equal(translateText('Award goal', 'de'), 'Tor geben');
  assert.equal(translateText('Award goal', 'ja'), 'ゴールを認定');
  assert.equal(translateText('Disallow goal', 'de'), 'Tor aberkennen');
  assert.equal(translateText('Ball', 'de'), 'Ball');
});

test('Slovak referee controls use football and keyboard terminology from PR 10', () => {
  for (const [source, expected] of Object.entries({
    '3. Goals': '3. Bránky',
    Goals: 'Góly',
    goals: 'góly',
    Space: 'Medzerník',
    'Kick ball (Space)': 'Kopnúť loptu (Medzerník)',
    'Make the call': 'Rozhodnite',
    'Goal resulting from pushing': 'Gól vyplývajúci z pushing',
  })) assert.equal(translateText(source, 'sk'), expected);
  assert.match(translateText('Call pushing whenever opposing robots touch', 'sk'), /^Vyhláste pushing/);
});

test('reviewed translations preserve the called-pushing premise and farther-robot selection', () => {
  const source = REFEREE_CASES.find((item) => item.id === 'pushing-goal').facts;
  for (const team of [
    source,
    transformText(source, { swap: true, reflect: false }),
  ]) {
    const slovak = translateText(team, 'sk');
    assert.match(slovak, /odpískal pushing/);
    assert.doesNotMatch(slovak, /odvolaný/);
    assert.match(translateText(team, 'de'), /pushing gepfiffen/);
    assert.match(translateText(team, 'ja'), /pushing を宣告/);
  }
  assert.equal(translateText('Goal not granted', 'sk'), 'Gól nebol uznaný');
  assert.equal(translateText('Goal not granted', 'de'), 'Tor nicht anerkannt');
  assert.equal(
    translateText('Goal not granted', 'ja'),
    'ゴールは認められません',
  );
  assert.match(
    translateText('Relocate farther defender', 'de'),
    /weiter vom Ball entfernten/,
  );
  assert.match(translateText('Relocate farther defender', 'ja'), /より遠い方/);
});

test('all text knowledge checks have translations for every answer and explanation', async () => {
  const { RULE_QUESTIONS } = await import('../lib/rulebook/questions.ts');
  for (const item of RULE_QUESTIONS)
    for (const text of [
      item.title,
      item.question,
      item.feedback,
      ...item.options,
    ])
      for (const locale of ['sk', 'de', 'ja']) {
        assert.ok(
          Object.hasOwn(generated.locales[locale].exact, text),
          `${locale}:${item.id}:${text}`,
        );
        assert.notEqual(
          translateText(text, locale),
          text,
          `${locale}:${item.id}`,
        );
      }
});

test('reviewed technical answers retain inclusive limits, test outcomes and repeated-entry meaning', async () => {
  const { RULE_QUESTIONS } = await import('../lib/rulebook/questions.ts');
  const correct = (id) => {
    const item = RULE_QUESTIONS.find((question) => question.id === id);
    assert.ok(item, id);
    return item.options[item.answer];
  };
  const radio = translateText(correct('radio-limits'), 'ja');
  assert.match(radio, /100 mW EIRP 以下/);
  assert.doesNotMatch(radio, /未満/);
  assert.match(
    translateText(correct('kicker-test-result'), 'sk'),
    /Test nevyhovel/,
  );
  assert.match(
    translateText(correct('kicker-test-result'), 'de'),
    /Test nicht bestanden/,
  );
  assert.match(translateText(correct('kicker-test-result'), 'ja'), /不合格/);
  assert.doesNotMatch(
    translateText(correct('kicker-test-result'), 'de'),
    /Passabpraller/,
  );
  assert.match(
    translateText(correct('repeated-out-damage'), 'sk'),
    /úplné vchádzanie do pokutového územia/,
  );
  assert.match(
    translateText(correct('repeated-out-damage'), 'de'),
    /vollständiges Einfahren in den Strafraum/,
  );
  assert.match(
    translateText(correct('repeated-out-damage'), 'ja'),
    /ペナルティーエリアに完全に入る/,
  );
  assert.match(
    translateText(correct('kicker-recheck'), 'ja'),
    /各ハーフの開始前/,
  );
  for (const locale of ['sk', 'de', 'ja']) {
    assert.match(
      translateText(correct('infrared-ball-change'), locale),
      /Soccer Infrared.*42 mm.*Entry/,
    );
    assert.match(
      translateText(correct('event-scope'), locale),
      /Entry.*SuperTeam/,
    );
  }
});

test('the separate Entry format name is not translated as registration or immigration', () => {
  for (const source of Object.keys(generated.locales.sk.exact).filter((text) =>
    /\bEntry\b/.test(text),
  ))
    for (const locale of ['sk', 'de', 'ja'])
      assert.match(
        translateText(source, locale),
        /Entry/,
        `${locale}:${source}`,
      );
});

test('dynamic templates retain their values after translation', () => {
  for (const locale of ['sk', 'de', 'ja']) {
    const result = translateText('Goal · Blue scores!', locale);
    assert.doesNotMatch(result, /\{\d+\}/);
    assert.notEqual(result, 'Goal · Blue scores!');
  }
  assert.match(
    translateText(
      'Ball moved to the furthest available different neutral spot.',
      'de',
    ),
    /anderen entferntesten/,
  );
  assert.match(
    translateText('Ball moved to the nearest available neutral spot.', 'de'),
    /zum nächstgelegenen/,
  );
});

test('nested referee feedback translates its generated explanation', () => {
  const source =
    'Expected Out of bounds · remove (Blue 1). Full entry is out of bounds. Remove the robot for one minute or until an earlier kickoff.';
  for (const locale of ['sk', 'de', 'ja']) {
    const result = translateText(source, locale);
    assert.match(result, /Out of bounds/);
    assert.match(result, /Blue 1/);
    assert.doesNotMatch(result, /Full entry is|Remove the robot/);
  }
});
