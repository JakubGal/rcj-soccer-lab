# Visible out-of-bounds event before a goal

The `out-goal` decision lesson previously reused the ordinary `goal-contact`
animation without showing its stated earlier infringement. Blue 2 remained in
its normal starting position; only the observation text said it was out.

The lesson now moves Blue 2 smoothly to the physical side wall by 1.5 seconds.
It remains in contact while the ball reaches the goal mouth at 3 seconds and
the back wall at 4 seconds. The referee then disallows the goal and removes
the offending robot. Wall contact uses the selected model's real footprint,
including asymmetric bodies, swapped teams, mirrored layouts and reversed ends.
The ordinary goal lesson and the other actors' paths are unchanged.

Rule basis: [Soccer 2026 §2.8](https://robocup-junior.github.io/soccer-rules/master/rules.html#out-of-bounds).
The relevant boundary is the physical wall, not simply crossing a white sideline.

This is an evidence-animation correction, not an adjudication change: the
four-second decision point, required calls, scoring, question inventory and
post-removal layout are preserved. Existing v2 answers remain valid; no new
certification round is required by this fix. A literal v2 answer trace is
regression-tested for all three models.

Browser QA on a disposable localhost profile verified the visible movement,
wall-contact decision frame, disallowed goal, removal of Blue 2 and completed
lesson. Automated coverage checks all 24 model/team/reflection/end combinations,
continuous movement without wall penetration, event ordering, and isolation
from the shared ordinary-goal animation.
