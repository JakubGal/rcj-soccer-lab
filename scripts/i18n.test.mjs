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

test('dynamic templates retain their values after translation', () => {
  for (const locale of ['sk', 'de', 'ja']) {
    const result = translateText('Goal · Blue scores!', locale);
    assert.doesNotMatch(result, /\{\d+\}/);
    assert.notEqual(result, 'Goal · Blue scores!');
  }
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
