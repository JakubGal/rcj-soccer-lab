# RCJ Soccer Lab

Interactive 3D rule explanations and referee practice for RoboCupJunior Soccer 2026. The application is designed to work as a full training tool and as a
small iframe embedded directly beside a rule.

Live application: <https://jakubgal.github.io/rcj-soccer-lab/>

## What is included

- A PlayCanvas 3D field generated from one auditable 2026 specification file.
- Rules-correct continuous carpet, inward boundary stripes, rounded penalty
  areas, neutral spots, matte walls/goals, and ball-return wedges with flat goal
  pockets.
- Six deterministic, frame-scrubbable rule situations.
- Explore, Learn, and Referee modes.
- Multiple camera presets plus free orbit/zoom.
- Selectable XLC Open 2020, XLC Innovation 2021, and lightweight proxy robot
  visuals, with camera-facing team labels and overhead numbers.
- A scored referee rubric that can accept legitimate discretion.
- A 120 Hz JoltPhysics dribbler/contact demonstration using a 42 mm ball,
  moving roller surface, bounded compliance, and live capture/backspin metrics.
- An engine-independent scenario format in `lib/simulator`.
- A development `window.snapshot()` hook for automated inspection.

The dribbler constants are a reduced-order teaching calibration. They are not a
certificate that a physical robot complies with the rules. Physics observations
and referee judgments intentionally remain separate.

## Run on localhost

On Windows, double-click `Start-RCJ-Soccer-Lab.cmd`. It starts the simulator,
opens <http://localhost:3000/>, and keeps the server running until Enter is
pressed in the launcher window.

For a normal development terminal:

```bash
pnpm install
pnpm dev
```

The local embed form also works, for example:

```text
http://localhost:3000/?embed=legal-dribbler-backspin&robot=xlc-innovation-2021
```

Validation commands:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Every push to `main` is also type-checked, statically exported, and deployed
to GitHub Pages by `.github/workflows/deploy-pages.yml`. The normal local and
Sites/Cloudflare builds remain unchanged.

## Embed a situation

Every scenario can be embedded using its stable ID:

```html
<iframe
  src="https://YOUR-SITE/?embed=legal-dribbler-backspin"
  title="Legal dribbler — RCJ Soccer Lab"
  loading="lazy"
  allowfullscreen
></iframe>
```

The simulator's **Embed** button copies the current scenario's complete iframe
snippet. Other IDs are exported in `lib/simulator/scenarios.ts`.

## Authoring model

Published rule clips use deterministic sampled transforms so that video,
scrubbing, and old rule examples remain stable. Live physics can replace selected
actor tracks when interaction is useful. Referee choices carry a grade, a
normalised score, and feedback; ambiguous situations can include more than one
fully accepted decision.

Primary specifications:

- [RoboCupJunior Soccer Rules 2026](https://robocup-junior.github.io/soccer-rules/master/rules.html)
- [2026 field specification](https://robocup-junior.github.io/soccer-rules/master/field_specification.html)
- [Open-source 42 mm infrared ball](https://github.com/robocup-junior/ir-golf-ball)

The field constants and derived reference planes are in
`lib/simulator/field-spec.ts`. Normative values follow the written field
specification dated 2026-06-03. Dimensions not fixed by the rules, such as wall
board thickness, follow the accompanying `SoccerField_202605.step` construction
model and are explicitly labelled as construction values.

## Robot asset pipeline

Browser-ready models live in `public/models/robots`. New designs should ideally
arrive as one resolved, colour-preserving GLB. STEP AP242/AP214 is also suitable:
`scripts/convert-cad-to-glb.py` imports it with CadQuery and
`scripts/prepare-robot-glb.py` uses Blender to correct axes, remove named helper
objects, merge materials, decimate, fit the current 180 mm envelope, and export
a compact GLB. `scripts/inspect-robot-glb.py` reports mesh bounds and materials
for QA.

A folder of individual STL or SolidWorks part files is insufficient when it
does not include assembly occurrence transforms, repeats, and material data.
Export the resolved top-level assembly instead. The selectable CAD mesh is only
the visual layer; the simulator deliberately keeps its stable Jolt collision
body and powered-dribbler model when a design changes.
