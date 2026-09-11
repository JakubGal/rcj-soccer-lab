import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
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
    if (url.startsWith(root.href) && !url.includes('/node_modules/')) {
      if (url.endsWith('.css'))
        return {
          format: 'module',
          shortCircuit: true,
          source: 'export default {};',
        };
      if (/\.tsx?$/.test(url))
        return {
          format: 'module',
          shortCircuit: true,
          source: ts.transpileModule(
            readFileSync(new URL(url), 'utf8').replaceAll(
              'import.meta.env',
              '({ BASE_URL: "/rcj-soccer-lab/" })',
            ),
            {
              compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext,
                jsx: ts.JsxEmit.ReactJSX,
              },
            },
          ).outputText,
        };
    }
    return nextLoad(url, context);
  },
});

const { CHARACTERS, COMMITTEE_VOICE_DISCLAIMER } =
  await import('../lib/committee/catalog.ts');
const {
  CommitteeCompanions,
  CommitteeFigure,
  CommitteeTourSlide,
  COMMITTEE_TOUR,
  readCommitteePreferences,
  subscribeCommitteeSurface,
} = await import('../components/committee/CommitteeCompanions.tsx');
const { COMMITTEE_EVENT_NAME, COMMITTEE_RESET_EVENT_NAME } =
  await import('../lib/committee/events.ts');
const render = (Component, props = {}) =>
  renderToStaticMarkup(createElement(Component, props));

test('tour introduces all eight people in seven slides, always pairing Jakub and Caroline', () => {
  assert.equal(COMMITTEE_TOUR.length, 7);
  assert.deepEqual(
    new Set(COMMITTEE_TOUR.flatMap((slide) => slide.characters)),
    new Set(CHARACTERS.map((character) => character.id)),
  );
  const seen = new Set();
  for (let index = 0; index < COMMITTEE_TOUR.length; index++) {
    const slide = COMMITTEE_TOUR[index];
    const html = render(CommitteeTourSlide, { index, pose: 'explain' });
    for (const id of slide.characters) {
      assert.match(html, new RegExp(`data-character="${id}"`));
      seen.add(id);
    }
    if (slide.characters.includes('jakub'))
      assert.ok(slide.characters.includes('caroline'));
    if (slide.characters.includes('caroline'))
      assert.ok(slide.characters.includes('jakub'));
    assert.match(html, /data-pose="explain"/);
    assert.match(html, /Meet your guide/);
  }
  assert.equal(seen.size, 8);
});

test('tour explains every main mode without changing navigation or claiming official appointment', () => {
  const html = COMMITTEE_TOUR.map((_, index) =>
    render(CommitteeTourSlide, { index, pose: 'encourage' }),
  ).join('');
  for (const phrase of [
    'Rules',
    '3D field',
    'Human vs human',
    'WASD',
    'arrow keys',
    'RefMate',
    'Step mode',
    'Continuous mode',
    'Academy',
    'guest',
    'backup',
  ])
    assert.ok(html.includes(phrase), phrase);
  assert.match(html, /not an official competition appointment/);
  assert.match(html, /During certification, we stay quiet/);
  assert.doesNotMatch(html, /<a\b|href=/);
});

test('all three sprite columns resolve under the GitHub Pages base path', () => {
  for (const character of CHARACTERS) {
    for (const [pose, position] of [
      ['celebrate', '0%'],
      ['explain', '50%'],
      ['encourage', '100%'],
    ]) {
      const html = render(CommitteeFigure, { character, pose });
      assert.ok(
        html.includes(`/rcj-soccer-lab/characters/${character.id}.png`),
      );
      assert.ok(html.includes(`--committee-position:${position}`));
      assert.match(html, /aria-hidden="true"/);
    }
  }
});

test('normal companion shell provides labelled controls, dismissal, and fictional-voice disclaimer', () => {
  const html = render(CommitteeCompanions, {
    mode: 'rules',
    embedded: false,
    assessmentActive: false,
  });
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /Meet the committee/);
  assert.match(html, /<dialog[^>]+aria-labelledby="committee-tour-title"/);
  assert.doesNotMatch(html, /<dialog[^>]+\sopen[\s=>]/);
  assert.match(html, /Close committee tour/);
  assert.match(html, /Skip tour/);
  assert.match(html, /Committee reactions/);
  assert.match(html, /Character motion/);
  assert.equal((html.match(/role="switch"/g) ?? []).length, 2);
  assert.ok(html.includes(COMMITTEE_VOICE_DISCLAIMER));
});

test('assessment and embedded contexts render no launcher, tour, hints, or live reactions', () => {
  for (const mode of ['rules', 'play', 'referee', 'academy']) {
    for (const [embedded, assessmentActive] of [
      [true, false],
      [false, true],
      [true, true],
    ]) {
      assert.equal(
        render(CommitteeCompanions, { mode, embedded, assessmentActive }),
        '',
      );
    }
  }
});

test('saved reaction and motion choices preserve explicit false values', () => {
  for (const reactions of [true, false])
    for (const motion of [true, false]) {
      assert.deepEqual(
        readCommitteePreferences({
          getItem: () => JSON.stringify({ reactions, motion }),
        }),
        { reactions, motion },
      );
    }
  assert.deepEqual(
    readCommitteePreferences({ getItem: () => '{"reactions":false}' }),
    { reactions: false, motion: true },
  );
});

test('unavailable, corrupt, and invalid preference storage safely falls back to defaults', () => {
  const defaults = { reactions: true, motion: true };
  for (const value of [
    null,
    '',
    '{broken',
    'false',
    '[]',
    '"oops"',
    '{"reactions":"false","motion":0}',
  ]) {
    assert.deepEqual(
      readCommitteePreferences({ getItem: () => value }),
      defaults,
    );
  }
  assert.deepEqual(readCommitteePreferences(null), defaults);
  assert.deepEqual(
    readCommitteePreferences({
      getItem() {
        throw new Error('Storage denied');
      },
    }),
    defaults,
  );
});

test('sprite stylesheet uses bounded gentle motion and unconditionally respects reduced motion', () => {
  const css = readFileSync(
    new URL('components/committee/committee.css', root),
    'utf8',
  );
  assert.match(css, /aspect-ratio:\s*1\s*\/\s*2/);
  assert.match(css, /background-size:\s*300%\s+100%/);
  assert.match(css, /\[data-motion=['"]?on['"]?\]/);
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.committee-companions\s+\.committee-figure\s*\{\s*animation:\s*none\s*!important;\s*transition:\s*none\s*!important;/,
  );
  assert.doesNotMatch(css, /animation:[^;]*infinite/);
});

test('surface lifecycle reset clears only its own notification stream and unsubscribes cleanly', () => {
  const target = new EventTarget();
  const events = [];
  let resets = 0;
  const unsubscribe = subscribeCommitteeSurface(
    target,
    'referee',
    (event) => events.push(event),
    () => {
      resets += 1;
    },
  );
  const event = {
    id: 'step-verdict',
    surface: 'referee',
    context: 'practice',
    outcome: 'correct',
    topic: 'goal',
  };
  const dispatch = (name, detail) =>
    target.dispatchEvent(new CustomEvent(name, { detail }));
  dispatch(COMMITTEE_EVENT_NAME, event);
  dispatch(COMMITTEE_EVENT_NAME, { ...event, surface: 'rules' });
  dispatch(COMMITTEE_EVENT_NAME, { ...event, outcome: 'invalid' });
  assert.deepEqual(events, [event]);
  dispatch(COMMITTEE_RESET_EVENT_NAME, { surface: 'rules' });
  dispatch(COMMITTEE_RESET_EVENT_NAME, null);
  assert.equal(resets, 0);
  dispatch(COMMITTEE_RESET_EVENT_NAME, { surface: 'referee' });
  assert.equal(resets, 1);
  unsubscribe();
  dispatch(COMMITTEE_EVENT_NAME, event);
  dispatch(COMMITTEE_RESET_EVENT_NAME, { surface: 'referee' });
  assert.equal(events.length, 1);
  assert.equal(resets, 1);
});
