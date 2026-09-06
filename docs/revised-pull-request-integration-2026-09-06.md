# Revised pull request integration — 2026-09-06

This review follows the earlier PR review and the out-goal animation correction. It reviews the five heads currently proposed by mrshu, not the superseded versions of those branches. The application remains GitHub-only; no hosting service, account backend, signing key or live academy record was changed.

## Disposition

| PR | Reviewed head | Integration |
| --- | --- | --- |
| [#3](https://github.com/JakubGal/rcj-soccer-lab/pull/3) | `6fb0836` | Merge with corrections: include the 20 mm goal-line stripe and exact body-to-goal-panel contact. Do not extend the penalty area into unmarked goal interior or outer lane. |
| [#4](https://github.com/JakubGal/rcj-soccer-lab/pull/4) | `f5284c5` | Merge with corrections: one observation per goal-pocket passage; a duplicate event cannot suppress another robot's infringement on the same tick. Both teams, swapped ends and sideways exit are covered. |
| [#9](https://github.com/JakubGal/rcj-soccer-lab/pull/9) | `304fe6f` | Merge and complete: correct primary/secondary sources, expose the shared clip in the actual lesson selector without duplicating questions, display holding inspection notes in lesson feedback, and translate the new note into SK/DE/JA. |
| [#11](https://github.com/JakubGal/rcj-soccer-lab/pull/11) | `38cd73f` | Close without merging automatic forgiveness. Add a regression matrix for the reported lifecycle instead: leaving the boundary and passing a reaction deadline do not serve an out penalty. |
| [#12](https://github.com/JakubGal/rcj-soccer-lab/pull/12) | `c757f02` | Merge: ordinary arranged-kickoff start signals award no assessment points; incorrect decisions in that window still count. Authored kickoff exercises remain graded. |

## Rule boundaries and additional fixes

- [Rule 2.8](https://robocup-junior.github.io/soccer-rules/master/rules.html#out-of-bounds) starts the one-minute penalty at removal. The training response deadline is only a scoring deadline. A robot returning from the wall without removal remains an unserved offender; its team's goal is still disallowed. The new tests cover wall/full-area infringements, remaining at/leaving the boundary, and 3/20/90 seconds elapsed. Removal starts a fresh 60-second bench timer and clears the on-field flag; a subsequent unrelated goal can count. Opponent-caused pushed-out waiver behavior remains intact.
- [Field specification §7](https://robocup-junior.github.io/soccer-rules/master/field_specification.html) describes a marked area in front of the goal, with the line part of that area. Include the entire goal-line stripe, but do not infer an additional penalty area behind it. A continuous approach test verifies full entry is detected and retained as a robot then straddles the goal mouth.
- Goal side/back panels are solid walls. Contact uses the actual projected robot polygons, including holes, rather than only a bounding box. Physics and adjudication now share one panel definition. Tests cover all three robot models, both ends, multiple yaws, exact touching and near misses. A pushed-out correction must leave the robot clear of those panels and no longer fully inside a penalty area.
- [Rule 2.5](https://robocup-junior.github.io/soccer-rules/master/rules.html#ball-movement) ball-control restrictions still apply alongside §6.2.1's 1.5 cm capturing-zone limit. Compliant depth alone does not establish legal holding. Inspection feedback retains that distinction in every supported language; quoted official provisions remain English.
- The match-halves clip primarily teaches the side swap/second kickoff from §2.2 and also appears under the match-length section §2.1. The certification inventory stays at **105 unique checks**.

## Assessment compatibility

This is a grading/geometry change, not another visual-only release. The policy is now `rcj-soccer-2026-v3`, and the replay engine is `referee-match-2026-v3`. The case evidence and replay schema formats themselves are unchanged.

- Do not execute or silently regrade v1/v2 evidence under v3.
- Existing unfinished rounds require an explicit participant restart before current-version certification. Old pending submissions cannot newly qualify under v3.
- Already signed certificates remain verifiable. Practice, history, completed old recordings and interrupted-game checkpoints are retained in backups/restart archives. Old recordings remain archival data, not current-engine interactive reviews.
- Recovery tests cover a v2 round with both completed and unfinished recordings across import, upgrade gating and explicit restart.

## Verification

- **250/250** simulation, rulebook, learning, certification-policy and translation tests pass.
- **60/60** GitHub academy, transport, replay, account UI and backup/recovery tests pass.
- TypeScript checking, production build, changed-code lint and `git diff --check` pass. Existing build warnings about large chunks and PlayCanvas Node-worker externalization remain; no claim of a clean whole-repository lint baseline is made.
- The real bounded issuer child validates a full 13-attempt test round in about 23.3 seconds with a 256 MiB JavaScript heap / 120-second limit. Its packet is 29,472 characters. This is synthetic local test evidence, not a production certificate.
- The synthetic 10,000-account test passes: signed directory 4,225,058 bytes, single profile update changes three files / 268,402 bytes. It does not claim 10,000 concurrent submissions or override GitHub quotas.
- Browser checks on the production build confirm the shared clip stays selected under §2.1, the inventory is still 105, the 3D lesson renders, and successful holding feedback displays the added explanation in English and Slovak. German/Japanese note coverage is automated-tested.

No synthetic passing certification was submitted to the public registry. Existing out-goal lead-up animation remains covered for all three robot models and both team/end transformations.
