import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const root = new URL('../', import.meta.url);

// Render the production controller and native UI components. The actual
// simulator supplies a frame; no browser, engine, or UI module is mocked.
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
    if (target)
      for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
        const candidate = new URL(`${target.href}${suffix}`);
        if (existsSync(candidate)) return nextResolve(candidate.href, context);
      }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
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

const { RefMateConsole } =
  await import('../components/simulator/RefMateConsole.tsx');
const { RefereeMatch } = await import('../lib/simulator/referee-match.ts');

const noop = () => {};
const makeFrame = () =>
  new RefereeMatch(73, {
    mode: 'continuous',
    duration: 180,
    recordMatchReplay: false,
  }).snapshot();
const render = (props = {}) =>
  renderToStaticMarkup(
    createElement(RefMateConsole, {
      frame: makeFrame(),
      running: false,
      target: 'blue-1',
      blocked: false,
      returnBlocked: false,
      startBlocked: false,
      transportBlocked: false,
      onSelect: noop,
      onCall: noop,
      onTransport: noop,
      onContinue: noop,
      onArrangeKickoff: noop,
      ...props,
    }),
  );
const buttons = (html) =>
  [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(
    ([markup, attributes, content]) => ({ markup, attributes, content }),
  );
const robotButtons = (html) =>
  buttons(html).filter(({ attributes }) =>
    /class="refmate-robot /.test(attributes),
  );
const disabled = (button) => /\sdisabled(?:=|\s|$)/.test(button.attributes);

test('the real controller renders A1/B1/A2/B2 order with the selected robot label', () => {
  const html = render({ target: 'yellow-2' });
  const tiles = robotButtons(html);
  assert.equal(tiles.length, 4);
  for (const [index, slot, label] of [
    [0, 'A1', 'Blue 1'],
    [1, 'B1', 'Yellow 1'],
    [2, 'A2', 'Blue 2'],
    [3, 'B2', 'Yellow 2'],
  ]) {
    assert.ok(
      tiles[index].attributes.includes(`aria-label="${slot} · ${label}`),
    );
    assert.ok(tiles[index].content.includes(`>${slot}</strong>`));
    assert.ok(tiles[index].content.includes(`>${label}</span>`));
    assert.ok(
      tiles[index].attributes.includes(`aria-pressed="${index === 3}"`),
    );
  }
  assert.match(
    html,
    /class="refmate-selected-actions"><strong><span[^>]*>B2 · Yellow 2<\/span>/,
  );
});

test('a real bench countdown rounds remaining simulation seconds up and does not invent a timer', () => {
  const session = new RefereeMatch(73, { mode: 'continuous', duration: 180 });
  assert.equal(
    session.submit(session.decisionKey, { action: 'out', target: 'blue-1' }),
    true,
  );
  const frame = session.snapshot();
  for (const [remaining, expected] of [
    [60, '1:00'],
    [59.001, '1:00'],
    [1.001, '0:02'],
    [0.001, '0:01'],
    [0, '0:00'],
  ]) {
    const html = render({
      frame: {
        ...frame,
        bench: frame.bench.map((entry) => ({ ...entry, remaining })),
      },
    });
    const tile = robotButtons(html)[0];
    assert.ok(tile.content.includes(`<output>${expected}</output>`), expected);
    assert.match(tile.attributes, /Return now/);
  }
  // Rendering the remote must not modify the actual simulator's timer.
  assert.equal(session.snapshot().bench[0].remaining, 60);
});

test('an unrepaired, ineligible robot keeps its tile and explicit Return now enabled', () => {
  const session = new RefereeMatch(73, { mode: 'continuous', duration: 180 });
  assert.equal(
    session.submit(session.decisionKey, {
      action: 'damaged',
      target: 'yellow-2',
    }),
    true,
  );
  const frame = session.snapshot();
  assert.equal(frame.bench[0].eligible, false);
  assert.equal(frame.bench[0].ready, false);
  const html = render({
    frame,
    target: 'yellow-2',
    blocked: true,
    returnBlocked: false,
  });
  const tiles = robotButtons(html);
  assert.ok(tiles.slice(0, 3).every(disabled));
  assert.equal(disabled(tiles[3]), false);
  assert.match(tiles[3].attributes, /B2 · Yellow 2 · Return now/);
  assert.match(tiles[3].content, /Repairing · Waiting/);
  const explicitReturn = buttons(html).find(
    ({ content }) => content === 'Return now',
  );
  assert.ok(explicitReturn);
  assert.equal(disabled(explicitReturn), false);
});

test('blocked operational controls cannot submit calls, returns, transport or kickoff arrangement', () => {
  const frame = makeFrame();
  frame.canArrangeKickoff = true;
  const html = render({
    frame,
    blocked: true,
    returnBlocked: true,
    startBlocked: true,
    transportBlocked: true,
  });
  const controls = buttons(html);
  assert.equal(controls.length, 12);
  for (const button of controls)
    assert.equal(disabled(button), true, button.content);
});

test('step feedback uses the shared continuation label and blocks continuation until ready', () => {
  const session = new RefereeMatch(73, { mode: 'step', duration: 180 });
  assert.equal(
    session.submit(session.decisionKey, { action: 'out', target: 'blue-1' }),
    true,
  );
  const frame = session.snapshot();
  assert.equal(frame.phase, 'feedback');
  assert.ok(frame.feedback);
  for (const continueLabel of [
    undefined,
    'Try again',
    'Next referee decision',
    'Continue to kickoff',
    'Resume match',
    'Dismiss feedback',
    'Resume count',
  ]) {
    for (const returnBlocked of [false, true]) {
      const html = render({
        frame,
        blocked: true,
        returnBlocked,
        continueLabel,
      });
      assert.match(html, /class="refmate-feedback" aria-live="polite"/);
      const continuation = buttons(html).find(
        ({ content }) => content === (continueLabel ?? 'Continue decision'),
      );
      assert.ok(continuation, continueLabel ?? 'default continuation label');
      assert.equal(disabled(continuation), returnBlocked);
    }
  }
});

test('continuous rendering hides correctness and clearly disclaims physical robot connectivity', () => {
  const session = new RefereeMatch(73, { mode: 'continuous', duration: 180 });
  assert.equal(
    session.submit(session.decisionKey, { action: 'out', target: 'blue-1' }),
    true,
  );
  const frame = session.snapshot();
  frame.feedback.title = 'HIDDEN ANSWER VERDICT';
  frame.feedback.detail = 'HIDDEN CORRECT RULE';
  const html = render({ frame });
  assert.doesNotMatch(html, /HIDDEN ANSWER VERDICT|HIDDEN CORRECT RULE/);
  assert.doesNotMatch(html, /class="refmate-feedback"/);
  assert.match(html, /RefMate-style training controller/);
  assert.match(html, /Training console/);
  assert.match(html, /Simulated link/);
  assert.match(
    html,
    /No Bluetooth connection or physical robot commands are sent\./,
  );
  assert.match(html, /Penalty timers use simulation time\./);
  assert.match(
    html,
    /Expiry and START ALL never return a robot automatically\./,
  );
  assert.match(
    html,
    /href="https:\/\/github\.com\/robocup-junior\/soccer-referee-app" target="_blank" rel="noreferrer"/,
  );
});
