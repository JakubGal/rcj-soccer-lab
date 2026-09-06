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
- A full **Rules** reader covering six official documents and 259 navigation
  entries, including appendices and footnotes.
- 32 additional gameplay animations with timelines, camera choices and questions,
  plus interactive inspection, kicker, field, ball and scoring workbenches.
- Three unified tabs: **Rules**, **Play**, and **Referee**.
- Complete English, Slovak, German, and Japanese interface/catalogue support,
  including generated match feedback, referee reviews, quizzes, and embeds.
- A situation library combining all 73 decision exercises, guided replays and
  detailed studies with their matching official sections, questions and saved
  completion checks.
- A Play mode with live 2v2 matches, manual driving, autonomous teams, and a
  scoreboard with timed games and automatic kickoffs.
- Referee AI match practice with 35 shuffled incidents, scored calls, real
  removals and return timers, goals, placements, restarts and replay.
- Multiple camera presets plus free orbit/zoom.
- Selectable XLC Open 2020, XLC Innovation 2021, and lightweight proxy robot
  visuals, with camera-facing team labels and overhead numbers.
- A scored referee rubric that can accept legitimate discretion.
- A deterministic single-owner ball system: the 42 mm ball stays at one stable
  robot-relative attachment point and changes to free motion only at an authored
  release.
- An engine-independent scenario format in `lib/simulator`.
- A development `window.snapshot()` hook for automated inspection.

Ball attachment is a visual teaching aid, not a certificate that a physical
robot complies with the rules. The legal example releases the ball during a
challenge; the illegal-holding example deliberately does not. Observable facts
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
pnpm test:match
pnpm test:rules
pnpm test:referee
pnpm test:learning
pnpm test:i18n
pnpm lint
pnpm build
```

## Languages

Use the language menu in the top-right corner. The selection is stored locally
and carried in `?lang=en`, `?lang=sk`, `?lang=de`, or `?lang=ja` through modes,
deep links, robot changes, and copied iframe embeds. Browser language is used
the first time the app opens without an explicit selection.

Rule-defined calls such as **Out of bounds**, **Damaged robot**, **Pushing**,
**Multiple defense**, and **Lack of progress** intentionally remain in their
official English wording. Exact official quotations and the cross-origin live
rulebook remain English; surrounding explanations and controls are translated.
The in-app translations are learning aids and do not replace the official
English source.

The checked-in runtime catalogue has no translation-service dependency. After
adding or changing authored English copy, maintainers can refresh it with:

```bash
pnpm i18n:generate
```

Machine-generated rule explanations should receive native-speaker committee
review before being treated as publication-ready wording.

Every push to `main` is also type-checked, statically exported, and deployed
to GitHub Pages by `.github/workflows/deploy-pages.yml`. The normal local and
Sites/Cloudflare builds remain unchanged.

## Play simulated games

Open **Play** in the top bar, or visit `/?mode=play`. Select **You vs AI** to
drive Blue 1 with an AI teammate against two opponents; **AI vs AI** lets both
teams play. Each team can also be set to manual with an AI teammate,
autonomous, or stationary. Picking any robot takes manual control of its team;
only one robot is directly driven at a time. Start the match to begin.

- **WASD / arrow keys:** robot-relative forward, backward, and sideways motion.
- **Q / E:** turn left / right. **Space:** kick a ball directly in front.
- **C:** switch to the other robot on the selected team.
- **P:** pause / resume. **R:** reset the match and score.
- The on-screen buttons can also be held, including on a touchscreen.

The manual robot's dribbler can be switched off. Match length is 1, 2, or 5
minutes; changing it resets the match. Input clears when paused, when switching
robots or control modes, or when the window loses focus. Backgrounding the page
pauses the game. Switching tabs pauses and preserves the current match.

Use **Arrange field** to drag robots or the ball, enter coordinates, rotate
robots, or choose an existing lesson layout. Start the match directly from
that arrangement. Arrow keys move the selected object 1 cm (5 cm with Shift),
Q/E rotate, and **Reset layout** restores the arrangement before editing.
The legacy `/?mode=manual` link opens this editor inside Play.

Play uses an independent 120 Hz planar model with swept robot collisions,
ball contact and damping, kicks, and goal-panel collisions. A goal counts when
the ball contacts the inside back wall. Goals restart automatically; stalled
AI play resets after 8 seconds. This is a practice game, without ball height,
ramp physics, or automatic referee penalties. Scripted rule lessons are in
Rules; manual arrangement and live driving share the Play field.

## Referee the AI teams

Open **Referee** in the top bar, select **Referee AI match** from Play, or open
`/?mode=referee`. The legacy `/?mode=play&referee=1` link still works. Both teams
play autonomously. Press **Whistle** (Space)
when you want to make a call, select the affected robot where relevant, and
choose your action. Goal buttons identify the scoring team directly. **P**
pauses playback. Other actions are available through the action-category menu.

**Match setup** offers **Step** and **Continuous** modes, a 1/3/5/10-minute
training match, and multiple topic checkboxes. Apply these with **Start new
match with these settings**. Step keeps the guided decision pauses and authored
drills. Continuous never stops for an uncalled incident: robots can touch the
wall and drive back, goals bounce back into play, and penalties still require
the referee. **Pause for decision** / Space freezes all actors, the ball,
reaction windows and training time until you act or resume.

Continuous accepts every referee decision exactly as entered. A wrong target is
removed, a premature placement still moves the ball, a goal is awarded to the
chosen team, and a benched robot can be returned immediately even when it is not
eligible. The trainer does not reveal or block on correctness during the match;
the referee may make additional corrective decisions and then resume the actual
resulting game state.

Continuous faults steer real robots through normal physics; they never load
an authored layout. Out-of-bounds, damage/fire, multiple defense, pushing,
stalled play and scoring opportunities are encouraged according to selected
topics. Restarts and return requests follow actual match events. Administrative
exercises remain available in Step. Natural incidents outside the selection
remain actionable but do not affect that session's accuracy.

Both modes finish with correct, wrong, missed and assisted totals plus accuracy
by topic: correct / (correct + wrong + missed). One situation counts once;
retries cannot recover first-attempt credit. Assisted work is excluded from
unaided accuracy. Continuous mode allows eight seconds for a persistent robot
penalty/goal and a short reaction window after positional contact clears;
uncalled discretionary pushing alone is not a missed violation. Full time
excludes new incidents with less than three seconds to react. **End match & see
results** also ends a session explicitly. Pauses themselves earn no points. At
full time, Continuous provides a chronological decision timeline containing the
actual call, expected call, physical effect and relevant rule. Missed calls are
placed at the moment the incident appeared, and every row can seek a detached
full-match replay of the game as it was actually refereed.

A visible count can start after one sustained second of little ball movement,
without guessing the later automatic stall detector. This is a permissive
training threshold, not a rulebook timeout. Placement still requires the full
illustrative count; resumed progress cancels it without a missed decision.

There are 35 authored situations spanning scoring, pushing and multiple defense,
lack of progress, out of bounds, ball movement, damaged robots and returns,
kickoffs, interference, stoppages and match checks. The shuffle visits every
case before repeating, with random delays, reflected layouts and swapped teams.
Legal situations are mixed in. The **Practice setup & coverage** panel shows
what you have encountered, lets you choose a drill or skip the gap before the
next incident, and provides a seed for repeating or changing the sequence.

In Step mode, normal AI play runs between drills. Live back-wall contacts, out-of-bounds
events and stalled play are held for assessment; whistling also evaluates live
pushing and multiple-defense geometry. Authored evidence stops before the
lesson's referee action and hides its answer captions. Observation notes
supply facts such as a reported power failure or unauthorized human contact.
Replay preserves the last situation, including its lead-up and decision
endpoint, without changing the live match. Rule links open the matching
section inside Rules; returning to Referee keeps the paused match.

In Step mode, correct calls apply to the match: remove robots with their motors
off, move the ball or the relevant defender to a clear neutral spot,
award/disallow goals, correct setups and restart play. Wrong calls leave the
guided drill unchanged and explain the rule and target to reconsider. Retrying
does not recover first-try credit. Accepted discretionary choices are labelled
**Supported referee judgment**. Combined infringements require successive
decisions using the updated ball position. Continuous instead applies every
submitted call and defers its explanation to the post-match review.

Benched robots stay absent from AI, collisions and new drills. Their penalty
starts at removal; normal play continues and return requires your permission,
readiness, time/kickoff eligibility and a clear neutral spot. The trainer
simulates repair completion after a short interval. Returning robots face
their own goal. Speed controls scale simulated play and penalty time together.

Decision reviews and authored evidence are training pauses: no match or bench
time is charged while studying them. The visible lack-of-progress count is a
teaching example, not a universal three-second rule. Holding inspection and
retrieving a ball kicked out use explicitly labelled exercise procedures where
the rule does not specify one mandatory restart. This covers the main Soccer
match situations; it does not claim to adjudicate every possible physical,
administrative or discretionary circumstance, or replace event officials.

The pure controller and case catalog are `lib/simulator/referee-match.ts` and
`lib/simulator/referee-cases.ts`. `pnpm test:referee` checks scoring, double-call
protection, grading, count sequencing, live geometry, removal, return eligibility,
symmetry, shuffle coverage and completion of every case in all four variants.
The normal Play engine keeps automatic goal/stall behavior unless referee mode
is explicitly enabled.

## Read and explore every rule

Open **Rules** in the top bar, or visit `/?mode=rules`. The contents cover the
complete main Soccer rules, field specification, ball specification, scoring
and judging guidelines, SuperTeam rules, and Entry rules. The federation
conduct policy incorporated by the rules is linked in the contents footer.

The **Situations** library combines the former Explore, Learn and scenario
Referee modes. Each entry opens its official section beside a replay and a
checking question. Multi-step incidents ask each decision in order, including
counts and return requests. Hints support practice, and successful final
answers mark a check as passed. These checks persist separately from reading
progress. **Previous situation** and **Next situation** follow the library;
the rule picker groups alternate situations for the same section. **All rules**
keeps the full document index and technical workbenches available. Existing
scenario links and embeds remain supported.

The official-text pane loads the original document, including every paragraph,
table, note and appendix. It requires internet access and has an **Open original**
link. The local index records the revision and source hash checked on
2026-09-05; the reader loads the live official pages, which may subsequently
change. Official paragraphs are not mirrored into the repository.

- Search section titles and numbers across all six documents. Select a section
  to jump to its official text and corresponding learning tool.
- Use split view, full-width text or the interactive guide. **Reviewed** marks
  persist in this browser. The URL remembers the selected rule and app mode.
- Every subsection of the main gameplay chapter has at least two animations.
  The penalty-area section has five examples covering pushing, ordinary
  contact, multiple defense, combined infringements and goals during pushing.
  Replay, scrub, jump to key moments, change speed/camera, and answer a question.
- The inspection workbench compares Vision and Infrared dimensions, mass,
  capture depth, handle clearance, marker diameter, voltage and radio power.
  Diagrams and limit checks update as measurements change. Its checklist links
  directly to relevant inspection paragraphs.
- The kicker bench compares rebound paths. The field and ball explorers show
  dimensions; the scoring explorer combines tournament placement, actual rubric
  grade choices, TDP bonuses and the Community Award point. Preparation guides
  cover team requirements, documentation, interviews and referee decisions.

The interactive guides are authored learning aids. Waiting periods in animations
may be compressed; the kicker diagram is a geometric illustration, and the
inspection checks do not replace official certification. These guides do not
add automatic enforcement of every rule to Play mode. Competition robots must
operate autonomously.

Entry and SuperTeam retain their own complete documents and format guides;
main-league animations and measurement limits are not applied to those formats.
The reader calls out source differences, including legacy large-ball details
and conflicting poster dimensions. Check event amendments with the organizers.

Rulebook data and learning logic live in `lib/rulebook`, and the reader and
workbenches in `components/rulebook`. After an official source update, refresh
the heading index and review the learning aids against the revised text:

```bash
python scripts/sync-rulebook.py
pnpm test:rules
```

The sync script indexes headings and counts paragraph/footnote blocks, records
source hashes, and handles duplicate source anchors. It does not generate new
animations or reinterpret changed rules. Tests cover chapter and source
coverage, animation timelines and contact geometry, neutral placements,
inspection boundaries, scoring conversion, search and separate-league routing.

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
scrubbing, speed changes, and old rule examples remain stable. A frame can name
one ball owner or no owner; the resolved ball pose is derived from the same
timeline as every robot. Referee choices carry a grade, a normalised score, and
feedback; ambiguous situations can include more than one fully accepted
decision.

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

The 2020 web asset has its single stray CAD triangle removed and its real body
centered and uniformly resized to the same 176 mm width as the 2021 model.
`scripts/repair-2020-robot.py` reproduces that correction from the original
asset, guarded by its source hash. After any mesh change, regenerate
`lib/simulator/robot-footprints.json` using `scripts/extract-robot-footprints.py`
so penalty-area evidence follows the visible body. Number badges sit above
each model's actual height; the shared collision circle contains both bodies.

A folder of individual STL or SolidWorks part files is insufficient when it
does not include assembly occurrence transforms, repeats, and material data.
Export the resolved top-level assembly instead. The selectable CAD mesh is only
the visual layer; robot choice does not change the standard ball attachment
point or any authored rule situation.
