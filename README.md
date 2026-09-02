# RCJ Soccer Lab

Interactive 3D rule explanations and referee practice for RoboCupJunior Soccer
2026. The application is designed to work as a full training tool and as a
small iframe embedded directly beside a rule.

## What is included

- A PlayCanvas 3D field generated from the official 2026 dimensions.
- Six deterministic, frame-scrubbable rule situations.
- Explore, Learn, and Referee modes.
- Multiple camera presets plus free orbit/zoom.
- A scored referee rubric that can accept legitimate discretion.
- A 120 Hz JoltPhysics dribbler/contact demonstration using a 42 mm ball,
  moving roller surface, bounded compliance, and live capture/backspin metrics.
- An engine-independent scenario format in `lib/simulator`.
- A development `window.snapshot()` hook for automated inspection.

The dribbler constants are a reduced-order teaching calibration. They are not a
certificate that a physical robot complies with the rules. Physics observations
and referee judgments intentionally remain separate.

## Run and validate

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm build
```

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
