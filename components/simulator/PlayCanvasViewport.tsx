'use client';

import { useEffect, useRef, useState } from 'react';
import type * as PC from 'playcanvas';

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
    [length, 0.004, width],
    [x, 0.008, z],
    material,
  );
  line.setLocalEulerAngles(0, yaw, 0);
  return line;
}

function buildField(pc: typeof PC, app: PC.Application) {
  const root = new pc.Entity('RCJ field');
  app.root.addChild(root);

  const turf = makeMaterial(pc, '#14704a', { gloss: 0.18 });
  const turfEdge = makeMaterial(pc, '#0e4f36', { gloss: 0.12 });
  const white = makeMaterial(pc, '#f2f7f5', { gloss: 0.2 });
  const markerBlack = makeMaterial(pc, '#132018', { gloss: 0.12 });
  const wall = makeMaterial(pc, '#111820', { metalness: 0.35, gloss: 0.72 });
  const wallTrim = makeMaterial(pc, '#263746', { metalness: 0.55, gloss: 0.8 });
  const blueGoal = makeMaterial(pc, '#2388ff', {
    emissive: '#176fce',
    opacity: 0.78,
  });
  const yellowGoal = makeMaterial(pc, '#ffd43b', {
    emissive: '#b78c00',
    opacity: 0.78,
  });

  addPrimitive(
    pc,
    root,
    'Field base',
    'box',
    [1.82, 0.035, 2.43],
    [0, -0.026, 0],
    turfEdge,
  );
  addPrimitive(
    pc,
    root,
    'Playing surface',
    'box',
    [1.58, 0.018, 2.19],
    [0, -0.004, 0],
    turf,
  );

  const halfWidth = 0.79;
  const halfLength = 1.095;
  addLine(pc, root, white, 0, -halfLength, 1.58, 0.02);
  addLine(pc, root, white, 0, halfLength, 1.58, 0.02);
  addLine(pc, root, white, -halfWidth, 0, 2.19, 0.02, 90);
  addLine(pc, root, white, halfWidth, 0, 2.19, 0.02, 90);

  const circleSegments = 40;
  const circleRadius = 0.3;
  const segmentLength = (Math.PI * 2 * circleRadius) / circleSegments + 0.004;
  for (let index = 0; index < circleSegments; index += 1) {
    const angle = (index / circleSegments) * Math.PI * 2;
    addLine(
      pc,
      root,
      markerBlack,
      Math.cos(angle) * circleRadius,
      Math.sin(angle) * circleRadius,
      segmentLength,
      0.007,
      90 - (angle * 180) / Math.PI,
    );
  }
  addPrimitive(
    pc,
    root,
    'Center neutral spot',
    'cylinder',
    [0.01, 0.004, 0.01],
    [0, 0.009, 0],
    markerBlack,
  );

  const penaltyWidth = 0.8;
  const penaltyDepth = 0.25;
  const cornerRadius = 0.15;
  for (const end of [-1, 1]) {
    const frontZ = end * (halfLength - penaltyDepth);
    addLine(pc, root, white, 0, frontZ, penaltyWidth - cornerRadius * 2, 0.02);
    addLine(
      pc,
      root,
      white,
      -penaltyWidth / 2,
      end * (halfLength - (penaltyDepth - cornerRadius) / 2),
      penaltyDepth - cornerRadius,
      0.02,
      90,
    );
    addLine(
      pc,
      root,
      white,
      penaltyWidth / 2,
      end * (halfLength - (penaltyDepth - cornerRadius) / 2),
      penaltyDepth - cornerRadius,
      0.02,
      90,
    );

    const arcSegments = 9;
    for (const side of [-1, 1]) {
      for (let index = 0; index < arcSegments; index += 1) {
        const startAngle = side < 0 ? Math.PI : Math.PI * 1.5;
        const angle = startAngle + (index / arcSegments) * (Math.PI / 2);
        const nextAngle =
          startAngle + ((index + 1) / arcSegments) * (Math.PI / 2);
        const centerX = side * (penaltyWidth / 2 - cornerRadius);
        const centerZ = end * (halfLength - penaltyDepth + cornerRadius);
        const x1 = centerX + Math.cos(angle) * cornerRadius;
        const x2 = centerX + Math.cos(nextAngle) * cornerRadius;
        const zSign = end < 0 ? 1 : -1;
        const z1 = centerZ + Math.sin(angle) * cornerRadius * zSign;
        const z2 = centerZ + Math.sin(nextAngle) * cornerRadius * zSign;
        const dx = x2 - x1;
        const dz = z2 - z1;
        addLine(
          pc,
          root,
          white,
          (x1 + x2) / 2,
          (z1 + z2) / 2,
          Math.hypot(dx, dz) + 0.003,
          0.02,
          (Math.atan2(-dz, dx) * 180) / Math.PI,
        );
      }
    }
  }

  for (const z of [-0.645, 0.645]) {
    for (const x of [-0.4, 0.4]) {
      addPrimitive(
        pc,
        root,
        'Neutral spot',
        'cylinder',
        [0.01, 0.004, 0.01],
        [x, 0.009, z],
        markerBlack,
      );
    }
  }

  const wallHeight = 0.22;
  addPrimitive(
    pc,
    root,
    'West wall',
    'box',
    [0.035, wallHeight, 2.43],
    [-0.91, wallHeight / 2, 0],
    wall,
  );
  addPrimitive(
    pc,
    root,
    'East wall',
    'box',
    [0.035, wallHeight, 2.43],
    [0.91, wallHeight / 2, 0],
    wall,
  );
  addPrimitive(
    pc,
    root,
    'North wall',
    'box',
    [1.82, wallHeight, 0.035],
    [0, wallHeight / 2, -1.215],
    wall,
  );
  addPrimitive(
    pc,
    root,
    'South wall',
    'box',
    [1.82, wallHeight, 0.035],
    [0, wallHeight / 2, 1.215],
    wall,
  );
  addPrimitive(
    pc,
    root,
    'West trim',
    'box',
    [0.042, 0.012, 2.44],
    [-0.91, wallHeight + 0.004, 0],
    wallTrim,
  );
  addPrimitive(
    pc,
    root,
    'East trim',
    'box',
    [0.042, 0.012, 2.44],
    [0.91, wallHeight + 0.004, 0],
    wallTrim,
  );

  const addGoal = (end: number, material: PC.StandardMaterial) => {
    const goal = new pc.Entity(end < 0 ? 'Blue goal' : 'Yellow goal');
    root.addChild(goal);
    const z = end * 1.169;
    addPrimitive(
      pc,
      goal,
      'Goal back',
      'box',
      [0.62, 0.1, 0.02],
      [0, 0.05, z],
      material,
    );
    addPrimitive(
      pc,
      goal,
      'Goal left',
      'box',
      [0.02, 0.1, 0.074],
      [-0.31, 0.05, end * 1.132],
      material,
    );
    addPrimitive(
      pc,
      goal,
      'Goal right',
      'box',
      [0.02, 0.1, 0.074],
      [0.31, 0.05, end * 1.132],
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
    [0.042, 0.042, 0.042],
    [0, 0.022, 0],
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
  app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, 2);
  app.scene.ambientLight = new pc.Color(0.24, 0.31, 0.36);
  app.scene.exposure = 1.18;

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
    cyan: makeMaterial(pc, '#56d7ff', { emissive: '#38bdf8', gloss: 0.8 }),
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
  addPrimitive(
    pc,
    ruleGeometry,
    'North penalty volume',
    'box',
    [0.8, 0.008, 0.25],
    [0, 0.012, -0.97],
    overlayAmber,
  );
  addPrimitive(
    pc,
    ruleGeometry,
    'South penalty volume',
    'box',
    [0.8, 0.008, 0.25],
    [0, 0.012, 0.97],
    overlayAmber,
  );

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
    color: new pc.Color(0.78, 0.9, 1),
    intensity: 1.55,
    castShadows: true,
    shadowDistance: 8,
    shadowResolution: 2048,
  });
  key.setEulerAngles(48, -32, 0);
  app.root.addChild(key);

  const fill = new pc.Entity('Fill light');
  fill.addComponent('light', {
    type: 'omni',
    color: new pc.Color(0.15, 0.55, 0.95),
    intensity: 0.9,
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

  const setCameraPreset = (
    preset: CameraPreset,
    poses: Record<string, Pose>,
  ) => {
    camera.camera!.projection = pc.PROJECTION_PERSPECTIVE;
    camera.camera!.orthoHeight = 1.5;
    orbit.target.set(0, 0.05, 0);
    if (preset === 'overhead') {
      camera.camera!.projection = pc.PROJECTION_ORTHOGRAPHIC;
      camera.camera!.orthoHeight = 1.36;
      orbit.yaw = 0;
      orbit.pitch = 89.8;
      orbit.distance = 3.3;
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

  const resizeObserver = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect;
    if (!rect || rect.width < 1 || rect.height < 1) return;
    app.resizeCanvas(Math.round(rect.width), Math.round(rect.height));
  });
  resizeObserver.observe(canvas.parentElement ?? canvas);

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
