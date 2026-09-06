# Open pull-request review — 6 September 2026

Reviewed all eight open pull requests by mrshu against the updated audit-fix
release e57d16b, including their complete diffs, tests and current official rule
sources. Integration preserves the contributor commits in merge history.

| PR                                                        | Outcome                             | Review / integration details                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#6](https://github.com/JakubGal/rcj-soccer-lab/pull/6)   | Integrated                          | Restores the selected action category after kickoff; adds return and keep-off calls to Common calls. Scheduled React state restoration avoids the current compiler lint violation and respects a later manual choice.                                                                                                                                             |
| [#7](https://github.com/JakubGal/rcj-soccer-lab/pull/7)   | Integrated                          | Corrects three authored scenario poses. Full-entry exclusion tests sample all scenarios across all three models without reverting the new pushing explanations.                                                                                                                                                                                                   |
| [#8](https://github.com/JakubGal/rcj-soccer-lab/pull/8)   | Integrated with corrections         | Centred Play kickoffs, running clock during goal pauses, ball-only neutral restarts. Preserved the new body-aware opponent-pressure code during conflict resolution. Corrected the neutral-spot description and first-versus-repeated relocation: the current free spot can be nearest on the first call; a failed repeat uses a different spot.                  |
| [#10](https://github.com/JakubGal/rcj-soccer-lab/pull/10) | Integrated with conflict resolution | Slovak football, keyboard and referee labels; preserved current question keys and already-reviewed goal wording. Added generator overrides and regression tests so regeneration retains the improvements. Obsolete English phrases were not restored.                                                                                                             |
| [#5](https://github.com/JakubGal/rcj-soccer-lab/pull/5)   | Closed as superseded                | e57d16b already freezes historical expected calls and response deadlines, with tests for genuine misses and transient conditions clearing before a fair response window. Adding a second snapshot mechanism would duplicate and weaken the current behavior.                                                                                                      |
| [#3](https://github.com/JakubGal/rcj-soccer-lab/pull/3)   | Changes requested; left open        | Valid goal-line-gap investigation, but the patch extends the assessed penalty region 140 mm to the outer wall without extending the displayed outline or establishing an official basis. White-stripe inclusion and goal-panel contact need separate handling; do not silently treat the unmarked outer lane as penalty area.                                     |
| [#4](https://github.com/JakubGal/rcj-soccer-lab/pull/4)   | Changes requested; left open        | Duplicate-goal investigation is useful. However, clearStaleOut unconditionally expires an unserved penalty and invalid ball passage on the response timeout—even if the robot is still out. Split deduplication from penalty lifecycle, and preserve the owner-requested carrier-passage policy.                                                                  |
| [#9](https://github.com/JakubGal/rcj-soccer-lab/pull/9)   | Changes requested; left open        | Contains useful kickoff-scoring/citation observations but also reverses the explicitly requested pushed-out training policy. The holding note must retain ball-freedom/access requirements, not reduce compliance to capture depth. Source anchors should not be kept inaccurate merely to satisfy animation-count coverage. Independent changes should be split. |

## Evidence and boundaries

- [Field specification](https://robocup-junior.github.io/soccer-rules/master/field_specification.html): marked penalty area and white line are distinct from the surrounding outer area; neutral spots are aligned with penalty-area sides, not inside the penalty areas.
- [Gameplay rules](https://robocup-junior.github.io/soccer-rules/master/rules.html): §2.3 centres the kickoff ball; §2.7 relocates the ball, not all robots; §2.8 does not give an unserved out penalty an automatic training-timeout expiry.
- Published referee discretion is distinguished from the selected committee training policy in `lib/simulator/training-policy.ts`. This integration does not silently change it.

Integration verification: **285 tests passed** (226 simulator/rules/content/
certification/i18n and 59 GitHub/replay/recovery/UI), including the real full
seven- and thirteen-game issuer fixtures. The thirteen-game packet occupied
29,161 issue characters and passed the secret-free 256 MiB validator in 24.7 s.
Type checking and production build passed. Changed files are lint-checked;
the previously documented shared UI/hook lint findings remain outside this change.

Browser testing on an isolated localhost profile confirmed that return controls
appear in Common calls and that arranging/signalling a kickoff restores Common
calls afterward, while an explicit All referee actions selection stays selected.
No public test certificates were issued. The three open PRs have
actionable request-changes reviews; they are not claimed as merged or fixed.
