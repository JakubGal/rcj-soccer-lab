'use client';

import { useEffect, useRef, useState } from 'react';
import type * as PC from 'playcanvas';

import {
  RCJ_FIELD_DERIVED,
  RCJ_FIELD_SPEC_2026,
} from '@/lib/simulator/field-spec';
import type { ActorDefinition, Pose } from '@/lib/simulator/types';

export type CameraPreset =
  | 'broadcast'
  | 'referee'
  | 'overhead'
  | 'ball'
  | 'blue'
  | 'yellow'
  | 'free';

type ViewportProps = {
  actors: ActorDefinition[];
  poses: Record<string, Pose>;
  cameraPreset: CameraPreset;
  showRuleGeometry: boolean;
  showBallTrail: boolean;
  showContactEvidence: boolean;
  ballTrail: Pose[];
  phaseLabel: string;
  onReady?: () => void;
};

type SceneHandles = {
  app: PC.Application;
  camera: PC.Entity;
  actorEntities: Map<string, PC.Entity>;
  trailEntities: PC.Entity[];
  ruleGeometry: PC.Entity;
  capturePlane: PC.Entity;
  contactEvidence: PC.Entity;
  dispose: () => void;
  setCameraPreset: (preset: CameraPreset, poses: Record<string, Pose>) => void;
  updateCameraTarget: (
    preset: CameraPreset,
    poses: Record<string, Pose>,
  ) => void;
};

const TEAM_COLORS = {
  blue: '#2388ff',
  yellow: '#ffd43b',
  neutral: '#ff7a45',
};

function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  };
}

function makeMaterial(
  pc: typeof PC,
  color: string,
  options: {
    metalness?: number;
    gloss?: number;
    emissive?: string;
    opacity?: number;
  } = {},
) {
  const rgb = hexToRgb(color);
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(rgb.r, rgb.g, rgb.b);
  material.metalness = options.metalness ?? 0;
  material.gloss = options.gloss ?? 0.45;
  if (options.emissive) {
    const glow = hexToRgb(options.emissive);
    material.emissive = new pc.Color(glow.r, glow.g, glow.b);
    material.emissiveIntensity = 1.25;
  }
  if (typeof options.opacity === 'number') {
    material.opacity = options.opacity;
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = false;
  }
  material.update();
  return material;
}

function addPrimitive(
  pc: typeof PC,
  parent: PC.Entity,
  name: string,
  type: 'box' | 'cylinder' | 'sphere' | 'cone',
  scale: [number, number, number],
  position: [number, number, number],
  material: PC.StandardMaterial,
) {
  const entity = new pc.Entity(name);
  entity.addComponent('render', { type });
  entity.render!.material = material;
  entity.setLocalScale(...scale);
  entity.setLocalPosition(...position);
  parent.addChild(entity);
  return entity;
}

function addLine(
  pc: typeof PC,
  parent: PC.Entity,
  material: PC.StandardMaterial,
  x: number,
  z: number,
  length: number,
  width: number,
  yaw = 0,
) {
  const line = addPrimitive(
    pc,
    parent,
    'Field marking',
    'box',
    [length, 0.001, width],
    [x, 0.0007, z],
    material,
  );
  line.setLocalEulerAngles(0, yaw, 0);
  return line;
}

type SurfacePoint = [x: number, y: number, z: number];

function addIndexedSurface(
  pc: typeof PC,
  app: PC.Application,
  parent: PC.Entity,
  name: string,
  positions: number[],
  sourceIndices: number[],
  material: PC.StandardMaterial,
) {
  const indices = [...sourceIndices];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset] * 3;
    const b = indices[offset + 1] * 3;
    const c = indices[offset + 2] * 3;
    const ux = positions[b] - positions[a];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vz = positions[c + 2] - positions[a + 2];
    if (uz * vx - ux * vz < 0) {
      [indices[offset + 1], indices[offset + 2]] = [
        indices[offset + 2],
        indices[offset + 1],
      ];
    }
  }
  const geometry = new pc.Geometry();
  geometry.positions = positions;
  geometry.indices = indices;
  geometry.calculateNormals();
  const mesh = pc.Mesh.fromGeometry(app.graphicsDevice, geometry);
  const meshInstance = new pc.MeshInstance(mesh, material);
  const entity = new pc.Entity(name);
  entity.addComponent('render', { meshInstances: [meshInstance] });
  parent.addChild(entity);
  return entity;
}

function addSurfacePolygon(
  pc: typeof PC,
  app: PC.Application,
  parent: PC.Entity,
  name: string,
  sourcePoints: SurfacePoint[],
  material: PC.StandardMaterial,
) {
  const signedArea = sourcePoints.reduce((area, point, index) => {
    const next = sourcePoints[(index + 1) % sourcePoints.length];
    return area + point[0] * next[2] - next[0] * point[2];
  }, 0);
  const points = signedArea > 0 ? [...sourcePoints].reverse() : sourcePoints;
  const center: SurfacePoint = [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
    points.reduce((sum, point) => sum + point[2], 0) / points.length,
  ];
  const positions = [center, ...points].flat();
  const indices: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    indices.push(0, index + 1, ((index + 1) % points.length) + 1);
  }
  return addIndexedSurface(pc, app, parent, name, positions, indices, material);
}

function addRingRibbon(
  pc: typeof PC,
  app: PC.Application,
  parent: PC.Entity,
  name: string,
  centerX: number,
  centerZ: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
  segments: number,
  material: PC.StandardMaterial,
) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = startAngle + ((endAngle - startAngle) * index) / segments;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    positions.push(
      centerX + cosine * outerRadius,
      0.0008,
      centerZ + sine * outerRadius,
      centerX + cosine * innerRadius,
      0.0008,
      centerZ + sine * innerRadius,
    );
    if (index < segments) {
      const outer = index * 2;
      const inner = outer + 1;
      const nextOuter = outer + 2;
      const nextInner = outer + 3;
      indices.push(outer, inner, nextOuter, nextOuter, inner, nextInner);
    }
  }
  return addIndexedSurface(pc, app, parent, name, positions, indices, material);
}

function addSegment(
  pc: typeof PC,
  parent: PC.Entity,
  material: PC.StandardMaterial,
  from: [x: number, z: number],
  to: [x: number, z: number],
  width: number,
) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  return addLine(
    pc,
    parent,
    material,
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    Math.hypot(dx, dz),
    width,
    (Math.atan2(-dz, dx) * 180) / Math.PI,
  );
}

function penaltyAreaOutline(end: -1 | 1, arcSegments = 20) {
  const spec = RCJ_FIELD_SPEC_2026;
  const derived = RCJ_FIELD_DERIVED;
  const outerHalfWidth = spec.penaltyArea.width / 2;
  const radius = spec.penaltyArea.outerCornerRadius;
  const points: Array<[number, number]> = [
    [-outerHalfWidth, end * derived.playingHalfLength],
    [-outerHalfWidth, end * derived.penaltyArcCenterZ],
  ];

  for (let index = 1; index <= arcSegments; index += 1) {
    const angle = (index / arcSegments) * (Math.PI / 2);
    points.push([
      -derived.penaltyArcCenterX - radius * Math.cos(angle),
      end * (derived.penaltyArcCenterZ - radius * Math.sin(angle)),
    ]);
  }
  points.push([
    derived.penaltyArcCenterX,
    end * (derived.penaltyArcCenterZ - radius),
  ]);
  for (let index = arcSegments - 1; index >= 0; index -= 1) {
    const angle = (index / arcSegments) * (Math.PI / 2);
    points.push([
      derived.penaltyArcCenterX + radius * Math.cos(angle),
      end * (derived.penaltyArcCenterZ - radius * Math.sin(angle)),
    ]);
  }
  points.push([outerHalfWidth, end * derived.playingHalfLength]);
  return points;
}

function buildField(pc: typeof PC, app: PC.Application) {
  const root = new pc.Entity('RCJ field');
  app.root.addChild(root);

  const spec = RCJ_FIELD_SPEC_2026;
  const derived = RCJ_FIELD_DERIVED;
  const turf = makeMaterial(pc, '#15794d', { gloss: 0.08 });
  const white = makeMaterial(pc, '#f4f5ef', { gloss: 0.12 });
  const markerBlack = makeMaterial(pc, '#050706', { gloss: 0.05 });
  const wall = makeMaterial(pc, '#080a0b', { gloss: 0.08 });
  const blueGoal = makeMaterial(pc, '#2774d8', { gloss: 0.1 });
  const yellowGoal = makeMaterial(pc, '#f0cc26', { gloss: 0.1 });

  addPrimitive(
    pc,
    root,
    'Continuous green carpet and base',
    'box',
    [spec.floor.width, spec.floor.constructionThickness, spec.floor.length],
    [0, -spec.floor.constructionThickness / 2, 0],
    turf,
  );

  // The white boundary is part of the 1.58 x 2.19 m playing envelope, so the
  // nominal 20 mm stripe extends inward from its exact outer dimensions.
  addLine(
    pc,
    root,
    white,
    0,
    -derived.boundaryLineCenterZ,
    spec.playingArea.width,
    spec.markings.whiteLineWidth,
  );
  addLine(
    pc,
    root,
    white,
    0,
    derived.boundaryLineCenterZ,
    spec.playingArea.width,
    spec.markings.whiteLineWidth,
  );
  addLine(
    pc,
    root,
    white,
    -derived.boundaryLineCenterX,
    0,
    spec.playingArea.length,
    spec.markings.whiteLineWidth,
    90,
  );
  addLine(
    pc,
    root,
    white,
    derived.boundaryLineCenterX,
    0,
    spec.playingArea.length,
    spec.markings.whiteLineWidth,
    90,
  );

  const centerCircleOuterRadius = spec.markings.centerCircleDiameter / 2;
  addRingRibbon(
    pc,
    app,
    root,
    '600 mm center circle',
    0,
    0,
    centerCircleOuterRadius,
    centerCircleOuterRadius - spec.markings.centerCircleStroke,
    0,
    Math.PI * 2,
    128,
    markerBlack,
  );
  addPrimitive(
    pc,
    root,
    'Center neutral spot',
    'cylinder',
    [
      spec.markings.neutralSpotDiameter,
      0.001,
      spec.markings.neutralSpotDiameter,
    ],
    [0, 0.0008, 0],
    markerBlack,
  );

  for (const end of [-1, 1] as const) {
    addSegment(
      pc,
      root,
      white,
      [-derived.penaltyArcCenterX, end * derived.penaltyFrontCenterZ],
      [derived.penaltyArcCenterX, end * derived.penaltyFrontCenterZ],
      spec.markings.whiteLineWidth,
    );
    for (const side of [-1, 1] as const) {
      addSegment(
        pc,
        root,
        white,
        [side * derived.penaltySideCenterX, end * derived.penaltyBackEdgeZ],
        [side * derived.penaltySideCenterX, end * derived.penaltyArcCenterZ],
        spec.markings.whiteLineWidth,
      );
    }

    const arcOuterRadius = spec.penaltyArea.outerCornerRadius;
    const arcInnerRadius =
      spec.penaltyArea.outerCornerRadius - spec.markings.whiteLineWidth;
    addRingRibbon(
      pc,
      app,
      root,
      `${end < 0 ? 'North' : 'South'} left penalty corner`,
      -derived.penaltyArcCenterX,
      end * derived.penaltyArcCenterZ,
      arcOuterRadius,
      arcInnerRadius,
      Math.PI,
      end > 0 ? Math.PI * 1.5 : Math.PI / 2,
      32,
      white,
    );
    addRingRibbon(
      pc,
      app,
      root,
      `${end < 0 ? 'North' : 'South'} right penalty corner`,
      derived.penaltyArcCenterX,
      end * derived.penaltyArcCenterZ,
      arcOuterRadius,
      arcInnerRadius,
      end > 0 ? Math.PI * 1.5 : Math.PI / 2,
      end > 0 ? Math.PI * 2 : 0,
      32,
      white,
    );
  }

  for (const z of [-derived.neutralSpotZ, derived.neutralSpotZ]) {
    for (const x of [-derived.neutralSpotX, derived.neutralSpotX]) {
      addPrimitive(
        pc,
        root,
        'Neutral spot',
        'cylinder',
        [
          spec.markings.neutralSpotDiameter,
          0.001,
          spec.markings.neutralSpotDiameter,
        ],
        [x, 0.0008, z],
        markerBlack,
      );
    }
  }

  // Rules-mandated 10 cm / 2 cm ramps. End ramps stop at the outside edges of
  // the goal pockets, leaving those pockets flat as required.
  const sideToe = derived.floorHalfWidth - spec.wedge.run;
  addSurfacePolygon(
    pc,
    app,
    root,
    'West return wedge',
    [
      [-derived.floorHalfWidth, spec.wedge.rise, -derived.floorHalfLength],
      [-sideToe, 0, -derived.floorHalfLength],
      [-sideToe, 0, derived.floorHalfLength],
      [-derived.floorHalfWidth, spec.wedge.rise, derived.floorHalfLength],
    ],
    turf,
  );
  addSurfacePolygon(
    pc,
    app,
    root,
    'East return wedge',
    [
      [sideToe, 0, -derived.floorHalfLength],
      [derived.floorHalfWidth, spec.wedge.rise, -derived.floorHalfLength],
      [derived.floorHalfWidth, spec.wedge.rise, derived.floorHalfLength],
      [sideToe, 0, derived.floorHalfLength],
    ],
    turf,
  );
  const endToe = derived.floorHalfLength - spec.wedge.run;
  const goalOuterHalfWidth =
    spec.goal.innerWidth / 2 + spec.goal.constructionPanelThickness;
  for (const end of [-1, 1] as const) {
    const wallZ = end * derived.floorHalfLength;
    const toeZ = end * endToe;
    const wallY = spec.wedge.rise;
    for (const [xMin, xMax] of [
      [-sideToe, -goalOuterHalfWidth],
      [goalOuterHalfWidth, sideToe],
    ] as const) {
      addSurfacePolygon(
        pc,
        app,
        root,
        `${end < 0 ? 'North' : 'South'} return wedge`,
        [
          [xMin, wallY, wallZ],
          [xMax, wallY, wallZ],
          [xMax, 0, toeZ],
          [xMin, 0, toeZ],
        ],
        turf,
      );
    }
  }

  const wallHeight = spec.wall.height;
  const wallThickness = spec.wall.constructionThickness;
  addPrimitive(
    pc,
    root,
    'West wall',
    'box',
    [wallThickness, wallHeight, spec.floor.length + wallThickness * 2],
    [-(derived.floorHalfWidth + wallThickness / 2), wallHeight / 2, 0],
    wall,
  );
  addPrimitive(
    pc,
    root,
    'East wall',
    'box',
    [wallThickness, wallHeight, spec.floor.length + wallThickness * 2],
    [derived.floorHalfWidth + wallThickness / 2, wallHeight / 2, 0],
    wall,
  );
  addPrimitive(
    pc,
    root,
    'North wall',
    'box',
    [spec.floor.width, wallHeight, wallThickness],
    [0, wallHeight / 2, -(derived.floorHalfLength + wallThickness / 2)],
    wall,
  );
  addPrimitive(
    pc,
    root,
    'South wall',
    'box',
    [spec.floor.width, wallHeight, wallThickness],
    [0, wallHeight / 2, derived.floorHalfLength + wallThickness / 2],
    wall,
  );

  const addGoal = (end: number, material: PC.StandardMaterial) => {
    const goal = new pc.Entity(end < 0 ? 'Blue goal' : 'Yellow goal');
    root.addChild(goal);
    const panelThickness = spec.goal.constructionPanelThickness;
    const sideDepth = spec.goal.innerDepth + panelThickness;
    const sideCenterZ = end * (derived.goalMouthZ + sideDepth / 2);
    const backCenterZ = end * (derived.goalBackInnerFaceZ + panelThickness / 2);
    addPrimitive(
      pc,
      goal,
      'Matte black goal back',
      'box',
      [
        spec.goal.innerWidth + panelThickness * 2,
        spec.goal.innerHeight,
        panelThickness,
      ],
      [0, spec.goal.innerHeight / 2, backCenterZ],
      wall,
    );
    addPrimitive(
      pc,
      goal,
      'Matte black left goal side',
      'box',
      [panelThickness, spec.goal.innerHeight, sideDepth],
      [
        -(spec.goal.innerWidth / 2 + panelThickness / 2),
        spec.goal.innerHeight / 2,
        sideCenterZ,
      ],
      wall,
    );
    addPrimitive(
      pc,
      goal,
      'Matte black right goal side',
      'box',
      [panelThickness, spec.goal.innerHeight, sideDepth],
      [
        spec.goal.innerWidth / 2 + panelThickness / 2,
        spec.goal.innerHeight / 2,
        sideCenterZ,
      ],
      wall,
    );

    // Thin colored skins sit inside the black boards, preserving the exact
    // 600 x 100 x 74 mm clear goal space.
    const colorSkin = 0.0006;
    const innerSideCenterZ =
      end * (derived.goalMouthZ + spec.goal.innerDepth / 2);
    addPrimitive(
      pc,
      goal,
      'Colored left interior',
      'box',
      [colorSkin, spec.goal.innerHeight, spec.goal.innerDepth],
      [
        -(spec.goal.innerWidth / 2 + colorSkin / 2),
        spec.goal.innerHeight / 2,
        innerSideCenterZ,
      ],
      material,
    );
    addPrimitive(
      pc,
      goal,
      'Colored right interior',
      'box',
      [colorSkin, spec.goal.innerHeight, spec.goal.innerDepth],
      [
        spec.goal.innerWidth / 2 + colorSkin / 2,
        spec.goal.innerHeight / 2,
        innerSideCenterZ,
      ],
      material,
    );
    addPrimitive(
      pc,
      goal,
      'Colored back interior',
      'box',
      [spec.goal.innerWidth, spec.goal.innerHeight, colorSkin],
      [
        0,
        spec.goal.innerHeight / 2,
        end * (derived.goalBackInnerFaceZ + colorSkin / 2),
      ],
      material,
    );
  };
  addGoal(-1, blueGoal);
  addGoal(1, yellowGoal);

  return root;
}

function buildRobot(
  pc: typeof PC,
  app: PC.Application,
  actor: ActorDefinition,
  shared: {
    dark: PC.StandardMaterial;
    blue: PC.StandardMaterial;
    yellow: PC.StandardMaterial;
    neutral: PC.StandardMaterial;
    cyan: PC.StandardMaterial;
    roller: PC.StandardMaterial;
    marker: PC.StandardMaterial;
  },
) {
  const root = new pc.Entity(actor.id);
  app.root.addChild(root);
  const teamMaterial = actor.team === 'blue' ? shared.blue : shared.yellow;

  // Team ownership is a virtual floor halo. The rendered robot itself stays
  // neutral because 2026 Rule 3.1 prohibits visible blue/yellow robot parts.
  addPrimitive(
    pc,
    root,
    'Virtual team halo',
    'cylinder',
    [0.19, 0.003, 0.19],
    [0, 0.004, 0],
    teamMaterial,
  );
  addPrimitive(
    pc,
    root,
    'Chassis',
    'cylinder',
    [0.17, 0.07, 0.17],
    [0, 0.043, 0],
    shared.dark,
  );
  addPrimitive(
    pc,
    root,
    'Team plate',
    'cylinder',
    [0.145, 0.025, 0.145],
    [0, 0.091, 0],
    shared.neutral,
  );
  addPrimitive(
    pc,
    root,
    'Controller',
    'box',
    [0.09, 0.035, 0.075],
    [0, 0.12, -0.005],
    shared.dark,
  );
  addPrimitive(
    pc,
    root,
    'Dribbler roller',
    'cylinder',
    [0.026, 0.115, 0.026],
    [0, 0.038, 0.088],
    actor.poweredDribbler ? shared.cyan : shared.roller,
  ).setLocalEulerAngles(0, 0, 90);
  addPrimitive(
    pc,
    root,
    'Top marker',
    'cylinder',
    [0.05, 0.006, 0.05],
    [0, 0.141, -0.005],
    shared.marker,
  );
  addPrimitive(
    pc,
    root,
    'Front direction',
    'cone',
    [0.035, 0.025, 0.035],
    [0, 0.116, 0.07],
    shared.cyan,
  ).setLocalEulerAngles(90, 0, 0);
  return root;
}

function buildBall(
  pc: typeof PC,
  app: PC.Application,
  materials: {
    ball: PC.StandardMaterial;
    ballDetail: PC.StandardMaterial;
  },
) {
  const root = new pc.Entity('ball');
  app.root.addChild(root);
  addPrimitive(
    pc,
    root,
    '42 mm ball',
    'sphere',
    [
      RCJ_FIELD_SPEC_2026.ball.diameter,
      RCJ_FIELD_SPEC_2026.ball.diameter,
      RCJ_FIELD_SPEC_2026.ball.diameter,
    ],
    [0, RCJ_FIELD_SPEC_2026.ball.diameter / 2 + 0.001, 0],
    materials.ball,
  );
  const spinMarker = addPrimitive(
    pc,
    root,
    'Spin marker',
    'cylinder',
    [0.011, 0.003, 0.011],
    [0, 0.022, 0.0205],
    materials.ballDetail,
  );
  spinMarker.setLocalEulerAngles(90, 0, 0);
  addPrimitive(
    pc,
    root,
    'Spin stripe',
    'box',
    [0.004, 0.033, 0.004],
    [0.0205, 0.022, 0],
    materials.ballDetail,
  );
  return root;
}

function buildScene(
  pc: typeof PC,
  canvas: HTMLCanvasElement,
  actors: ActorDefinition[],
): SceneHandles {
  const app = new pc.Application(canvas, {
    graphicsDeviceOptions: {
      alpha: false,
      antialias: true,
      powerPreference: 'high-performance',
    },
  });
  const maxRenderPixelRatio = 2;
  app.graphicsDevice.maxPixelRatio = maxRenderPixelRatio;
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.scene.ambientLight = new pc.Color(0.31, 0.31, 0.3);
  app.scene.exposure = 1.12;

  buildField(pc, app);

  const materials = {
    dark: makeMaterial(pc, '#121b23', { metalness: 0.68, gloss: 0.78 }),
    blue: makeMaterial(pc, TEAM_COLORS.blue, {
      metalness: 0.25,
      gloss: 0.72,
      emissive: '#0b3566',
      opacity: 0.34,
    }),
    yellow: makeMaterial(pc, TEAM_COLORS.yellow, {
      metalness: 0.2,
      gloss: 0.66,
      emissive: '#554200',
      opacity: 0.34,
    }),
    neutral: makeMaterial(pc, '#8b969f', { metalness: 0.48, gloss: 0.64 }),
    cyan: makeMaterial(pc, '#e879f9', { emissive: '#9d3bb0', gloss: 0.62 }),
    roller: makeMaterial(pc, '#e6edf2', { metalness: 0.7, gloss: 0.8 }),
    marker: makeMaterial(pc, '#f5f7f8', { gloss: 0.3 }),
    ball: makeMaterial(pc, TEAM_COLORS.neutral, {
      emissive: '#6d1c05',
      gloss: 0.62,
    }),
    ballDetail: makeMaterial(pc, '#4f1709', { gloss: 0.28 }),
  };

  const actorEntities = new Map<string, PC.Entity>();
  for (const actor of actors) {
    const entity =
      actor.kind === 'ball'
        ? buildBall(pc, app, materials)
        : buildRobot(pc, app, actor, materials);
    actorEntities.set(actor.id, entity);
  }

  const ruleGeometry = new pc.Entity('Rule geometry overlays');
  app.root.addChild(ruleGeometry);
  const overlayBlue = makeMaterial(pc, '#38bdf8', {
    emissive: '#0b5f88',
    opacity: 0.2,
  });
  const overlayAmber = makeMaterial(pc, '#f4bd50', {
    emissive: '#76500a',
    opacity: 0.16,
  });
  const capturePlane = addPrimitive(
    pc,
    ruleGeometry,
    'Capture plane',
    'box',
    [0.15, 0.1, 0.008],
    [0, 0.052, 0.03],
    overlayBlue,
  );
  for (const end of [-1, 1] as const) {
    addSurfacePolygon(
      pc,
      app,
      ruleGeometry,
      `${end < 0 ? 'North' : 'South'} rounded penalty area`,
      penaltyAreaOutline(end).map(([x, z]) => [x, 0.003, z]),
      overlayAmber,
    );
  }

  const contactEvidence = new pc.Entity('Contact evidence');
  app.root.addChild(contactEvidence);
  const contactGlow = makeMaterial(pc, '#ff6b6b', {
    emissive: '#ff2e2e',
    opacity: 0.75,
  });
  addPrimitive(
    pc,
    contactEvidence,
    'Contact pulse',
    'sphere',
    [0.065, 0.065, 0.065],
    [0, 0.06, 0],
    contactGlow,
  );

  const trailEntities: PC.Entity[] = [];
  const trailMaterial = makeMaterial(pc, '#38bdf8', {
    emissive: '#0e8fbf',
    opacity: 0.72,
  });
  for (let index = 0; index < 36; index += 1) {
    const dot = addPrimitive(
      pc,
      app.root,
      `Ball trail ${index}`,
      'sphere',
      [0.012, 0.012, 0.012],
      [0, -1, 0],
      trailMaterial,
    );
    trailEntities.push(dot);
  }

  const key = new pc.Entity('Key light');
  key.addComponent('light', {
    type: 'directional',
    color: new pc.Color(1, 0.98, 0.94),
    intensity: 1.35,
    castShadows: true,
    shadowDistance: 8,
    shadowResolution: 2048,
  });
  key.setEulerAngles(48, -32, 0);
  app.root.addChild(key);

  const fill = new pc.Entity('Fill light');
  fill.addComponent('light', {
    type: 'omni',
    color: new pc.Color(0.78, 0.82, 0.86),
    intensity: 0.62,
    range: 5,
  });
  fill.setPosition(-1.4, 2.1, 0.8);
  app.root.addChild(fill);

  const camera = new pc.Entity('Camera');
  camera.addComponent('camera', {
    clearColor: new pc.Color(0.025, 0.045, 0.06),
    fov: 48,
    nearClip: 0.01,
    farClip: 30,
  });
  app.root.addChild(camera);

  const orbit = {
    yaw: 35,
    pitch: 49,
    distance: 3.25,
    target: new pc.Vec3(0, 0.05, 0),
    dragging: false,
    x: 0,
    y: 0,
  };

  const updateOrbit = () => {
    const yaw = (orbit.yaw * Math.PI) / 180;
    const pitch = (orbit.pitch * Math.PI) / 180;
    const horizontal = Math.cos(pitch) * orbit.distance;
    camera.setPosition(
      orbit.target.x + Math.sin(yaw) * horizontal,
      orbit.target.y + Math.sin(pitch) * orbit.distance,
      orbit.target.z + Math.cos(yaw) * horizontal,
    );
    camera.lookAt(orbit.target);
  };

  const actorPose = (poses: Record<string, Pose>, team: 'blue' | 'yellow') => {
    const actor = actors.find(
      (item) => item.kind === 'robot' && item.team === team,
    );
    return actor ? poses[actor.id] : undefined;
  };

  let activePreset: CameraPreset = 'broadcast';
  const fitOverheadCamera = () => {
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.height > 0 ? rect.width / rect.height : 1;
    const margin = 0.07;
    const halfWidth =
      RCJ_FIELD_DERIVED.floorHalfWidth +
      RCJ_FIELD_SPEC_2026.wall.constructionThickness +
      margin;
    const halfLength =
      RCJ_FIELD_DERIVED.floorHalfLength +
      RCJ_FIELD_SPEC_2026.wall.constructionThickness +
      margin;
    camera.camera!.orthoHeight = Math.max(halfLength, halfWidth / aspect);
  };

  const setCameraPreset = (
    preset: CameraPreset,
    poses: Record<string, Pose>,
  ) => {
    activePreset = preset;
    camera.camera!.projection = pc.PROJECTION_PERSPECTIVE;
    camera.camera!.orthoHeight = 1.5;
    orbit.target.set(0, 0.05, 0);
    if (preset === 'overhead') {
      camera.camera!.projection = pc.PROJECTION_ORTHOGRAPHIC;
      orbit.yaw = 0;
      orbit.pitch = 89.8;
      orbit.distance = 3.3;
      fitOverheadCamera();
    } else if (preset === 'referee') {
      orbit.yaw = 88;
      orbit.pitch = 24;
      orbit.distance = 2.55;
    } else if (preset === 'ball') {
      const ballActor = actors.find((item) => item.kind === 'ball');
      const pose = ballActor ? poses[ballActor.id] : undefined;
      if (pose) orbit.target.set(pose.x, 0.03, pose.z);
      orbit.yaw = 35;
      orbit.pitch = 19;
      orbit.distance = 0.72;
    } else if (preset === 'blue' || preset === 'yellow') {
      const pose = actorPose(poses, preset);
      if (pose) orbit.target.set(pose.x, 0.06, pose.z);
      orbit.yaw = preset === 'blue' ? 18 : 198;
      orbit.pitch = 18;
      orbit.distance = 0.82;
    } else if (preset === 'free') {
      orbit.yaw = -35;
      orbit.pitch = 38;
      orbit.distance = 2.7;
    } else {
      orbit.yaw = 34;
      orbit.pitch = 46;
      orbit.distance = 3.15;
    }
    updateOrbit();
  };

  const updateCameraTarget = (
    preset: CameraPreset,
    poses: Record<string, Pose>,
  ) => {
    if (preset === 'ball') {
      const ballActor = actors.find((item) => item.kind === 'ball');
      const pose = ballActor ? poses[ballActor.id] : undefined;
      if (pose)
        orbit.target.lerp(
          orbit.target,
          new pc.Vec3(pose.x, 0.03, pose.z),
          0.14,
        );
      updateOrbit();
    } else if (preset === 'blue' || preset === 'yellow') {
      const pose = actorPose(poses, preset);
      if (pose)
        orbit.target.lerp(
          orbit.target,
          new pc.Vec3(pose.x, 0.06, pose.z),
          0.14,
        );
      updateOrbit();
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    orbit.dragging = true;
    orbit.x = event.clientX;
    orbit.y = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!orbit.dragging) return;
    const dx = event.clientX - orbit.x;
    const dy = event.clientY - orbit.y;
    orbit.x = event.clientX;
    orbit.y = event.clientY;
    orbit.yaw -= dx * 0.22;
    orbit.pitch = Math.max(8, Math.min(86, orbit.pitch + dy * 0.18));
    updateOrbit();
  };
  const onPointerUp = (event: PointerEvent) => {
    orbit.dragging = false;
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    orbit.distance = Math.max(
      0.45,
      Math.min(5.2, orbit.distance * (1 + event.deltaY * 0.001)),
    );
    updateOrbit();
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const resizeTarget = canvas.parentElement ?? canvas;
  const resizeRenderer = (width: number, height: number) => {
    if (width < 1 || height < 1) return;
    app.graphicsDevice.resizeCanvas(Math.round(width), Math.round(height));
    if (activePreset === 'overhead') fitOverheadCamera();
  };
  const resizeObserver = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect;
    if (!rect) return;
    resizeRenderer(rect.width, rect.height);
  });
  resizeObserver.observe(resizeTarget);
  const initialRect = resizeTarget.getBoundingClientRect();
  resizeRenderer(initialRect.width, initialRect.height);

  app.start();
  updateOrbit();

  return {
    app,
    camera,
    actorEntities,
    trailEntities,
    ruleGeometry,
    capturePlane,
    contactEvidence,
    setCameraPreset,
    updateCameraTarget,
    dispose: () => {
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      app.destroy();
    },
  };
}

export function PlayCanvasViewport({
  actors,
  poses,
  cameraPreset,
  showRuleGeometry,
  showBallTrail,
  showContactEvidence,
  ballTrail,
  phaseLabel,
  onReady,
}: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SceneHandles | null>(null);
  const posesRef = useRef(poses);
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    posesRef.current = poses;
  }, [poses]);

  useEffect(() => {
    let cancelled = false;
    let handles: SceneHandles | null = null;
    const canvas = canvasRef.current;
    if (!canvas) return;

    import('playcanvas')
      .then((pc) => {
        if (cancelled) return;
        handles = buildScene(pc, canvas, actors);
        sceneRef.current = handles;
        onReady?.();
      })
      .catch((error: unknown) => {
        setEngineError(
          error instanceof Error
            ? error.message
            : 'Unable to start the 3D renderer.',
        );
      });

    return () => {
      cancelled = true;
      handles?.dispose();
      sceneRef.current = null;
    };
  }, [actors, onReady]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    for (const actor of actors) {
      const pose = poses[actor.id];
      const entity = scene.actorEntities.get(actor.id);
      if (!pose || !entity) {
        if (entity) entity.enabled = false;
        continue;
      }
      entity.enabled = true;
      entity.setPosition(pose.x, 0, pose.z);
      if (actor.kind === 'ball') {
        entity.setEulerAngles((pose.yaw * 180) / Math.PI, 0, 0);
      } else {
        entity.setEulerAngles(0, (pose.yaw * 180) / Math.PI, 0);
      }
    }
    scene.updateCameraTarget(cameraPreset, poses);
  }, [actors, cameraPreset, poses]);

  useEffect(() => {
    sceneRef.current?.setCameraPreset(cameraPreset, posesRef.current);
  }, [cameraPreset]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.ruleGeometry.enabled = showRuleGeometry;
    scene.contactEvidence.enabled = showContactEvidence;

    const actor = actors.find((item) => item.kind === 'ball');
    const ballPose = actor ? poses[actor.id] : undefined;
    if (ballPose)
      scene.contactEvidence.setPosition(ballPose.x, 0.02, ballPose.z);

    const dribblerActor = actors.find(
      (item) => item.kind === 'robot' && item.poweredDribbler,
    );
    const dribblerPose = dribblerActor ? poses[dribblerActor.id] : undefined;
    if (dribblerPose) {
      const planeDistance = 0.102;
      scene.capturePlane.setPosition(
        dribblerPose.x + Math.sin(dribblerPose.yaw) * planeDistance,
        0.052,
        dribblerPose.z + Math.cos(dribblerPose.yaw) * planeDistance,
      );
      scene.capturePlane.setEulerAngles(
        0,
        (dribblerPose.yaw * 180) / Math.PI,
        0,
      );
      scene.capturePlane.enabled = showRuleGeometry;
    } else {
      scene.capturePlane.enabled = false;
    }

    scene.trailEntities.forEach((entity, index) => {
      const pose = ballTrail[index];
      entity.enabled = showBallTrail && Boolean(pose);
      if (pose) {
        const scale = 0.55 + (index / Math.max(ballTrail.length, 1)) * 0.55;
        entity.setPosition(pose.x, 0.023, pose.z);
        entity.setLocalScale(0.012 * scale, 0.012 * scale, 0.012 * scale);
      }
    });
  }, [
    actors,
    ballTrail,
    poses,
    showBallTrail,
    showContactEvidence,
    showRuleGeometry,
  ]);

  return (
    <div className="relative size-full min-h-[380px] overflow-hidden bg-[#071016]">
      <canvas
        ref={canvasRef}
        className="block size-full touch-none cursor-grab active:cursor-grabbing"
        aria-label={`Interactive 3D RoboCupJunior soccer field. Current phase: ${phaseLabel}. Drag to orbit and scroll to zoom.`}
      />
      {engineError ? (
        <div className="absolute inset-0 grid place-items-center bg-[#071016] p-8 text-center">
          <div>
            <p className="text-sm font-semibold text-red-300">
              3D renderer unavailable
            </p>
            <p className="mt-2 max-w-sm text-xs leading-5 text-white/55">
              {engineError}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
