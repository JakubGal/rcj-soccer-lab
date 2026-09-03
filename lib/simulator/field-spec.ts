/**
 * RoboCupJunior Soccer 2026 competition-field geometry, in metres.
 *
 * Normative dimensions come from the field specification dated 2026-06-03.
 * Construction dimensions that the written rules intentionally leave open
 * (panel thickness and the thin center-circle stroke) follow the committee's
 * accompanying SoccerField_202605.step reference model.
 *
 * PlayCanvas coordinates use X across the short side and Z along the long side.
 */
export const RCJ_FIELD_SPEC_2026 = {
  revision: '2026-06-03',
  sourceUrl:
    'https://robocup-junior.github.io/soccer-rules/master/field_specification.html',
  referenceCadUrl:
    'https://github.com/robocup-junior/soccer-rules/blob/master/media/CAD/SoccerField_202605.step',
  floor: {
    width: 1.82,
    length: 2.43,
    constructionThickness: 0.02,
  },
  playingArea: {
    width: 1.58,
    length: 2.19,
    outerArea: 0.12,
  },
  markings: {
    whiteLineWidth: 0.02,
    whiteLineTolerance: 0.002,
    centerCircleDiameter: 0.6,
    centerCircleStroke: 0.005,
    neutralSpotDiameter: 0.01,
  },
  penaltyArea: {
    width: 0.8,
    depth: 0.25,
    outerCornerRadius: 0.15,
  },
  neutralSpots: {
    fromShortEdge: 0.45,
  },
  wall: {
    height: 0.22,
    constructionThickness: 0.02,
  },
  wedge: {
    run: 0.1,
    rise: 0.02,
    riseTolerance: 0.01,
  },
  goal: {
    innerWidth: 0.6,
    innerHeight: 0.1,
    innerDepth: 0.074,
    constructionPanelThickness: 0.01,
  },
  ball: {
    diameter: 0.042,
  },
} as const;

/** Non-normative visual guides shared by the interactive teaching scenes. */
export const RCJ_SIMULATOR_GUIDES = {
  robotCapturePlaneForward: 0.102,
  // A conservative circular footprint that contains every selectable robot
  // visual, including protruding corners on the imported CAD models.
  robotCollisionRadius: 0.1,
} as const;

const spec = RCJ_FIELD_SPEC_2026;

export const RCJ_FIELD_DERIVED = {
  floorHalfWidth: spec.floor.width / 2,
  floorHalfLength: spec.floor.length / 2,
  playingHalfWidth: spec.playingArea.width / 2,
  playingHalfLength: spec.playingArea.length / 2,
  boundaryLineCenterX:
    spec.playingArea.width / 2 - spec.markings.whiteLineWidth / 2,
  boundaryLineCenterZ:
    spec.playingArea.length / 2 - spec.markings.whiteLineWidth / 2,
  penaltySideCenterX:
    spec.penaltyArea.width / 2 - spec.markings.whiteLineWidth / 2,
  penaltyArcCenterX:
    spec.penaltyArea.width / 2 - spec.penaltyArea.outerCornerRadius,
  penaltyArcCenterZ:
    spec.playingArea.length / 2 -
    spec.markings.whiteLineWidth -
    (spec.penaltyArea.depth - spec.penaltyArea.outerCornerRadius),
  penaltyStrokeRadius:
    spec.penaltyArea.outerCornerRadius - spec.markings.whiteLineWidth / 2,
  penaltyFrontCenterZ:
    spec.playingArea.length / 2 -
    spec.markings.whiteLineWidth -
    spec.penaltyArea.depth +
    spec.markings.whiteLineWidth / 2,
  penaltyBackEdgeZ: spec.playingArea.length / 2 - spec.markings.whiteLineWidth,
  neutralSpotX: spec.penaltyArea.width / 2 - spec.markings.whiteLineWidth / 2,
  neutralSpotZ: spec.playingArea.length / 2 - spec.neutralSpots.fromShortEdge,
  goalMouthZ: spec.playingArea.length / 2 - spec.markings.whiteLineWidth,
  goalBackInnerFaceZ:
    spec.playingArea.length / 2 -
    spec.markings.whiteLineWidth +
    spec.goal.innerDepth,
  goalBackContactBallCenterZ:
    spec.playingArea.length / 2 -
    spec.markings.whiteLineWidth +
    spec.goal.innerDepth -
    spec.ball.diameter / 2,
} as const;
