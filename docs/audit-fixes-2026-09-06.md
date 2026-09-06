# Rules and certification audit corrections

This release addresses the confirmed defects in the 6 September 2026 audit of
commit `92d949e`. It keeps the app on GitHub Pages with GitHub Actions verification;
it adds no login service, paid backend, or ChatGPT dependency.

## Corrected behavior

| Audit area                                     | Correction                                                                                                                                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1: correct lesson answers rejected            | Reconstruct the exact versioned lesson from its model, seed and operation trace. Both local and GitHub grading use the resulting concrete decisions; first-answer mistakes remain latched.               |
| A2: active attempt prematurely fails round     | Unfinished games still count toward possible qualifying successes. They have an explicit resume path and cannot consume another start accidentally.                                                      |
| A3: model changes alter examination answers    | Lock lesson/game geometry for certification and reject model-changing replay operations at verification. Ordinary practice remains selectable.                                                           |
| A4: rounded scores qualify below threshold     | Compare exact ratios to 90%/80%; round only for display.                                                                                                                                                 |
| A5: save/recovery/review                       | Retry failed result saves, persist bounded fixed-tick checkpoints, preserve an append-only decision history across competing tabs, and reopen completed Continuous timelines/replays and Step summaries. |
| R1: visible wall contact disagrees with ruling | Use the selected model's rotated body outline for wall bounds, clamping and adjudication. Ordinary Play also propagates its selected model to physics.                                                   |
| R2: retrospective missed call expects Play on  | Freeze concrete expected calls, evidence and response windows while an incident exists. Transient events that clear before the required window are not converted into contradictory misses.              |
| R3: kickoff forces optional returns            | A team may keep an eligible robot off. The engine and kickoff button no longer require all eligible robots to return.                                                                                    |
| R4: both-damaged wait freezes                  | The Continuous waiting clock and repeated award intervals advance without an accidental Step gate. Repair cues vary and are explicitly simulated team readiness, not a rule-defined repair duration.     |
| R5: unrelated pushing affects a later goal     | Associate pushing with its affected ball passage and clear stale associations across subsequent passages.                                                                                                |
| R6: equal-distance defenders                   | Accept either defender within a defined measurement tolerance. This is a training grading tolerance, not a claimed official tie-break.                                                                   |
| C1/C2: misleading teaching and translations    | Remove invented pushing prerequisites; repair confirmed consequential Slovak/German/Japanese wording and add semantic regression checks.                                                                 |
| Requested pushed-out policy gap                | Apply opponent-pressure evidence to both exterior-wall and full-penalty-area cases. Keep the requested waiver and post-removal ball-passage policy explicitly separate from published rules.             |
| Coverage                                       | Add 32 source-linked technical, safety, radio/interference, repeated-infringement and administration questions. The inventory is 105 checks across 28 main-rule anchors.                                 |

## Version and existing progress

New rounds use policy `rcj-soccer-2026-v2` and replay engine
`referee-match-2026-v2`: all 105 questions, at least 100 first-try correct,
five qualifying Step games out of eight starts, and two qualifying Continuous
games out of five starts. Each qualifying game is ten simulated minutes.

Older unfinished rounds are read-only and require an explicit restart. They are
not silently evaluated under changed answers or geometry. Existing practice
history, old evidence in backups and signed certificates remain preserved.
Previously signed certificates do not claim completion of the updated examination.

## Verification and limits

Regression coverage includes all concrete lesson cases across all three robot
models, real compressed submission decoding, complete seven-/thirteen-game
fixtures, secret-free issuer validation, exact score boundaries, checkpoint
rehydration, save retries, competing tabs, legacy progress, and translations.
GitHub Pages deployment now runs all simulation/content/certification suites as
well as the existing GitHub verification suite.

The browser check used a disposable localhost profile. The back-wall goal and
Two partial defenders answers produced `2/105, 100%`; reloading a Continuous
attempt restored 0:14, both recorded decisions, the removed robot and its timer,
without another attempt. Ending early stored an incomplete result; reopening its
saved timeline and full-match replay worked. No synthetic public certificate or
GitHub issue was created. Complete qualifying rounds were exercised by automated
fixtures, not claimed as an unaided human examination.

Final local validation: **279/279 tests passed** (220 simulation/rules/content/
certification/i18n plus 59 GitHub/replay/recovery/UI tests), TypeScript passed,
production build passed, and changed-file lint passed. The real secret-free
256 MiB validator processed the full thirteen-game fixture in 22.3 seconds,
inside its 120-second limit. That submission occupied 29,163 issue characters.
The newly added Vision inspection question also saved correctly in the browser,
bringing the disposable round to `3/105, 100%`.

Remaining scope boundaries are deliberate: ten-minute training sessions are not
full two-half matches; Step decisions pause the teaching clock; planar physics
does not naturally simulate high balls; Entry/SuperTeam and full tournament
organization are not certified by this result. Neutral-spot/orientation placement
is still assisted rather than a separately assessed manual-placement skill.
The assessment is unproctored and is not official appointment or identity proof.
Translations still warrant native-speaking referee review before high-stakes use.

Local checkpoints are not cloud synchronization. Abrupt shutdown can lose the
latest unsaved seconds, storage quotas still apply, and backup imports have a
16 MiB size limit. The old 19 shared UI/hook lint findings are separate from these
rule and certification repairs; changed implementation files are lint-checked.
