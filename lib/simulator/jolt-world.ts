import initJolt from 'jolt-physics/wasm-compat';

type JoltApi = Awaited<ReturnType<typeof initJolt>>;
type BodyId = InstanceType<JoltApi['BodyID']>;
type Shape = InstanceType<JoltApi['Shape']>;
type Vec3 = InstanceType<JoltApi['Vec3']>;
type RVec3 = InstanceType<JoltApi['RVec3']>;
type Quat = InstanceType<JoltApi['Quat']>;
type JoltInterface = InstanceType<JoltApi['JoltInterface']>;
type PhysicsSystem = InstanceType<JoltApi['PhysicsSystem']>;
type BodyInterface = InstanceType<JoltApi['BodyInterface']>;
type ContactListener = InstanceType<JoltApi['ContactListenerJS']>;

let joltModulePromise: Promise<JoltApi> | null = null;

function loadJoltModule(): Promise<JoltApi> {
  joltModulePromise ??= initJolt();
  return joltModulePromise;
}

export interface PhysicsVector3 {
  x: number;
  y: number;
  z: number;
}

export interface PhysicsQuaternion extends PhysicsVector3 {
  w: number;
}

export interface PhysicsBodySnapshot {
  position: PhysicsVector3;
  rotation: PhysicsQuaternion;
  linearVelocity: PhysicsVector3;
  angularVelocity: PhysicsVector3;
}

export interface DribblerSnapshot extends PhysicsBodySnapshot {
  active: boolean;
  contact: boolean;
  contactSteps: number;
  surfaceSpeedMps: number;
  targetBackspinRadPerSec: number;
  ballBackspinRadPerSec: number;
  ballForwardDistanceM: number;
  lateralOffsetM: number;
  captureDepthM: number;
  captureDepthMm: number;
  within15MmCaptureLimit: boolean;
  helperForceN: number;
}

export interface RcjPhysicsSnapshot {
  engine: 'jolt-physics';
  simulationTime: number;
  fixedStepHz: 120;
  interpolationAlpha: number;
  ball: PhysicsBodySnapshot;
  robot: PhysicsBodySnapshot;
  dribbler: DribblerSnapshot;
}

const OBJECT_LAYER_STATIC = 0;
const OBJECT_LAYER_MOVING = 1;
const OBJECT_LAYER_COUNT = 2;

const BROAD_PHASE_STATIC = 0;
const BROAD_PHASE_MOVING = 1;
const BROAD_PHASE_LAYER_COUNT = 2;

const USER_DATA_FIELD = 1;
const USER_DATA_WALL = 2;
const USER_DATA_BALL = 10;
const USER_DATA_ROBOT = 20;
const USER_DATA_DRIBBLER = 21;

const FIXED_STEP = 1 / 120;
const MAX_FRAME_DELTA = 0.1;
const MAX_CATCH_UP_STEPS = 12;

// Metres, kilograms, seconds. X is field width, Y is up, Z is field length.
const FIELD_WIDTH = 1.82;
const FIELD_LENGTH = 2.43;
const FLOOR_THICKNESS = 0.04;
const WALL_THICKNESS = 0.025;
const WALL_HEIGHT = 0.22;

// 2026 Soccer Vision profile: the passive orange ball is 42 mm and 46 g.
// Soccer Infrared also moves to 42 mm in the main 2026 rules, but its finished
// open-hardware mass must be measured before adding a separate calibrated profile.
const BALL_RADIUS = 0.021;
const BALL_MASS = 0.046;
const ROBOT_RADIUS = 0.075;
const ROBOT_HALF_HEIGHT = 0.045;
const ROBOT_MASS = 1.15;

const DRIBBLER_HALF_WIDTH = 0.058;
const DRIBBLER_HALF_HEIGHT = 0.018;
const DRIBBLER_HALF_DEPTH = 0.008;
const DRIBBLER_CENTER_FORWARD = ROBOT_RADIUS + 0.012;
const DRIBBLER_FACE_FORWARD = DRIBBLER_CENTER_FORWARD + DRIBBLER_HALF_DEPTH;

// The virtual capture plane includes a 1 mm calibration margin below the
// 15 mm limit so normal contact tolerances remain visibly on the legal side.
const CAPTURE_LIMIT = 0.015;
const CAPTURE_CALIBRATION_MARGIN = 0.001;
const CAPTURE_PLANE_FORWARD =
  DRIBBLER_FACE_FORWARD + CAPTURE_LIMIT - CAPTURE_CALIBRATION_MARGIN;
const TARGET_BALL_FORWARD = DRIBBLER_FACE_FORWARD + BALL_RADIUS + 0.0015;

const ROLLER_SURFACE_SPEED = 1.5;
const TARGET_BACKSPIN = -ROLLER_SURFACE_SPEED / BALL_RADIUS;
const DRIBBLER_MAX_FORCE = 0.85;
const DRIBBLER_SPRING = 48;
const DRIBBLER_DAMPING = 1.35;
const DRIBBLER_LATERAL_SPRING = 28;
const DRIBBLER_LATERAL_DAMPING = 0.8;
const DRIBBLER_MAX_TORQUE = 0.018;
const DRIBBLER_BACKSPIN_GAIN = 0.00055;
const DEMO_ROBOT_SPEED = 0.18;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Small, browser-only Jolt world used by the RCJ rule visualizer.
 *
 * It intentionally models the dribbler at rule-explanation fidelity: Jolt
 * supplies rigid contacts and a moving contact surface, while a bounded
 * spring/torque controller represents belt compliance and motor torque. Those
 * constants are a reduced-order teaching calibration, not certification data
 * for any competition robot or a substitute for measurement on real hardware.
 */
export class RcjJoltWorld {
  static async create(): Promise<RcjJoltWorld> {
    if (typeof WebAssembly === 'undefined') {
      throw new Error(
        'RCJ physics could not start because this browser does not provide WebAssembly.',
      );
    }

    try {
      const Jolt = await loadJoltModule();
      return new RcjJoltWorld(Jolt);
    } catch (error) {
      throw new Error(
        `RCJ Jolt physics failed to initialize. The simulator can continue with its scripted fallback. ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  private readonly Jolt: JoltApi;
  private jolt: JoltInterface | null = null;
  private physicsSystem: PhysicsSystem | null = null;
  private bodyInterface: BodyInterface | null = null;
  private contactListener: ContactListener | null = null;

  private ballId: BodyId | null = null;
  private robotId: BodyId | null = null;
  private dribblerId: BodyId | null = null;
  private readonly staticBodyIds: BodyId[] = [];

  private dribblerPositionScratch: RVec3 | null = null;
  private dribblerRotationScratch: Quat | null = null;
  private forceScratch: Vec3 | null = null;
  private torqueScratch: Vec3 | null = null;
  private surfaceVelocityBody1Scratch: Vec3 | null = null;
  private surfaceVelocityBody2Scratch: Vec3 | null = null;

  private accumulator = 0;
  private simulationTime = 0;
  private dribblerActive = true;
  private contactSeenThisStep = false;
  private contactActive = false;
  private contactSteps = 0;
  private lastHelperForceN = 0;
  private lastBallForwardDistance = TARGET_BALL_FORWARD;
  private lastLateralOffset = 0;
  private lastCaptureDepth = 0;
  private lastBallBackspin = 0;
  private disposed = false;

  private constructor(Jolt: JoltApi) {
    this.Jolt = Jolt;

    try {
      this.initialize();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** Enables or disables the roller motor and its compliant capture helper. */
  setActive(active: boolean): void {
    this.assertReady();
    this.dribblerActive = active;
    if (!active) {
      this.lastHelperForceN = 0;
    }
  }

  /** Restores the compact legal-dribbling teaching scene. */
  resetDribblerDemo(): RcjPhysicsSnapshot {
    const bodyInterface = this.requireBodyInterface();
    const { Jolt } = this;
    const ballId = this.requireBodyId(this.ballId, 'ball');
    const robotId = this.requireBodyId(this.robotId, 'robot');
    const dribblerId = this.requireBodyId(this.dribblerId, 'dribbler');

    const robotPosition = new Jolt.RVec3(0, ROBOT_HALF_HEIGHT + 0.004, -0.42);
    const robotRotation = new Jolt.Quat(0, 0, 0, 1);
    const robotVelocity = new Jolt.Vec3(0, 0, DEMO_ROBOT_SPEED);
    const zero = new Jolt.Vec3(0, 0, 0);

    const ballPosition = new Jolt.RVec3(
      0,
      BALL_RADIUS + 0.001,
      -0.42 + TARGET_BALL_FORWARD,
    );
    const ballRotation = new Jolt.Quat(0, 0, 0, 1);
    const ballVelocity = new Jolt.Vec3(0, 0, DEMO_ROBOT_SPEED);
    const ballAngularVelocity = new Jolt.Vec3(TARGET_BACKSPIN * 0.72, 0, 0);

    const dribblerPosition = new Jolt.RVec3(
      0,
      BALL_RADIUS,
      -0.42 + DRIBBLER_CENTER_FORWARD,
    );
    const dribblerRotation = new Jolt.Quat(0, 0, 0, 1);

    try {
      bodyInterface.SetPositionRotationAndVelocity(
        robotId,
        robotPosition,
        robotRotation,
        robotVelocity,
        zero,
      );
      bodyInterface.SetPositionRotationAndVelocity(
        ballId,
        ballPosition,
        ballRotation,
        ballVelocity,
        ballAngularVelocity,
      );
      bodyInterface.SetPositionRotationAndVelocity(
        dribblerId,
        dribblerPosition,
        dribblerRotation,
        robotVelocity,
        zero,
      );
      bodyInterface.ActivateBody(robotId);
      bodyInterface.ActivateBody(ballId);
      bodyInterface.ActivateBody(dribblerId);
    } finally {
      Jolt.destroy(robotPosition);
      Jolt.destroy(robotRotation);
      Jolt.destroy(robotVelocity);
      Jolt.destroy(zero);
      Jolt.destroy(ballPosition);
      Jolt.destroy(ballRotation);
      Jolt.destroy(ballVelocity);
      Jolt.destroy(ballAngularVelocity);
      Jolt.destroy(dribblerPosition);
      Jolt.destroy(dribblerRotation);
    }

    this.accumulator = 0;
    this.simulationTime = 0;
    this.contactSeenThisStep = false;
    this.contactActive = false;
    this.contactSteps = 0;
    this.lastHelperForceN = 0;
    this.updateDribblerMetrics();

    return this.getSnapshot();
  }

  /**
   * Advances with a 120 Hz fixed timestep. Frame deltas are clamped so a
   * backgrounded browser tab cannot create an unstable catch-up burst.
   */
  step(deltaSeconds: number): RcjPhysicsSnapshot {
    this.assertReady();

    const safeDelta = clamp(finiteOrZero(deltaSeconds), 0, MAX_FRAME_DELTA);
    this.accumulator += safeDelta;
    let substeps = 0;

    while (this.accumulator >= FIXED_STEP && substeps < MAX_CATCH_UP_STEPS) {
      this.contactSeenThisStep = false;
      this.applyRobotDriveController();
      this.moveDribblerWithRobot(FIXED_STEP);
      this.applyReducedOrderDribbler();

      this.jolt!.Step(FIXED_STEP, 1);

      this.contactActive = this.contactSeenThisStep;
      if (this.contactActive) {
        this.contactSteps += 1;
      }
      this.updateDribblerMetrics();

      this.simulationTime += FIXED_STEP;
      this.accumulator -= FIXED_STEP;
      substeps += 1;
    }

    if (substeps === MAX_CATCH_UP_STEPS && this.accumulator >= FIXED_STEP) {
      // Drop only stale accumulated time; never change the fixed physics dt.
      this.accumulator %= FIXED_STEP;
    }

    return this.getSnapshot();
  }

  getSnapshot(): RcjPhysicsSnapshot {
    const ball = this.readBody(this.requireBodyId(this.ballId, 'ball'));
    const robot = this.readBody(this.requireBodyId(this.robotId, 'robot'));
    const dribblerBody = this.readBody(
      this.requireBodyId(this.dribblerId, 'dribbler'),
    );

    return {
      engine: 'jolt-physics',
      simulationTime: this.simulationTime,
      fixedStepHz: 120,
      interpolationAlpha: clamp(this.accumulator / FIXED_STEP, 0, 1),
      ball,
      robot,
      dribbler: {
        ...dribblerBody,
        active: this.dribblerActive,
        contact: this.contactActive,
        contactSteps: this.contactSteps,
        surfaceSpeedMps: ROLLER_SURFACE_SPEED,
        targetBackspinRadPerSec: TARGET_BACKSPIN,
        ballBackspinRadPerSec: this.lastBallBackspin,
        ballForwardDistanceM: this.lastBallForwardDistance,
        lateralOffsetM: this.lastLateralOffset,
        captureDepthM: this.lastCaptureDepth,
        captureDepthMm: this.lastCaptureDepth * 1000,
        within15MmCaptureLimit: this.lastCaptureDepth <= CAPTURE_LIMIT + 0.0005,
        helperForceN: this.lastHelperForceN,
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const { Jolt } = this;
    const physicsSystem = this.physicsSystem;
    const bodyInterface = this.bodyInterface;

    if (physicsSystem && this.contactListener) {
      // The binding accepts a null pointer even though its declaration only
      // exposes ContactListener. Detach before freeing the JS callback object.
      physicsSystem.SetContactListener(null as unknown as ContactListener);
    }

    if (bodyInterface) {
      const bodyIds = [
        this.ballId,
        this.robotId,
        this.dribblerId,
        ...this.staticBodyIds,
      ];

      for (const bodyId of bodyIds) {
        if (!bodyId) continue;
        try {
          if (bodyInterface.IsAdded(bodyId)) bodyInterface.RemoveBody(bodyId);
          bodyInterface.DestroyBody(bodyId);
        } finally {
          Jolt.destroy(bodyId);
        }
      }
    }

    this.ballId = null;
    this.robotId = null;
    this.dribblerId = null;
    this.staticBodyIds.length = 0;

    const ownedObjects = [
      this.contactListener,
      this.dribblerPositionScratch,
      this.dribblerRotationScratch,
      this.forceScratch,
      this.torqueScratch,
      this.surfaceVelocityBody1Scratch,
      this.surfaceVelocityBody2Scratch,
    ];

    for (const object of ownedObjects) {
      if (object) Jolt.destroy(object);
    }

    this.contactListener = null;
    this.dribblerPositionScratch = null;
    this.dribblerRotationScratch = null;
    this.forceScratch = null;
    this.torqueScratch = null;
    this.surfaceVelocityBody1Scratch = null;
    this.surfaceVelocityBody2Scratch = null;

    if (this.jolt) Jolt.destroy(this.jolt);
    this.jolt = null;
    this.physicsSystem = null;
    this.bodyInterface = null;
  }

  private initialize(): void {
    const { Jolt } = this;
    let objectFilter: InstanceType<
      JoltApi['ObjectLayerPairFilterTable']
    > | null = null;
    let broadPhaseInterface: InstanceType<
      JoltApi['BroadPhaseLayerInterfaceTable']
    > | null = null;
    let broadPhaseFilter: InstanceType<
      JoltApi['ObjectVsBroadPhaseLayerFilterTable']
    > | null = null;
    let settings: InstanceType<JoltApi['JoltSettings']> | null = null;
    let ownershipTransferred = false;

    try {
      objectFilter = new Jolt.ObjectLayerPairFilterTable(OBJECT_LAYER_COUNT);
      objectFilter.EnableCollision(OBJECT_LAYER_STATIC, OBJECT_LAYER_MOVING);
      objectFilter.EnableCollision(OBJECT_LAYER_MOVING, OBJECT_LAYER_MOVING);

      broadPhaseInterface = new Jolt.BroadPhaseLayerInterfaceTable(
        OBJECT_LAYER_COUNT,
        BROAD_PHASE_LAYER_COUNT,
      );
      const staticLayer = new Jolt.BroadPhaseLayer(BROAD_PHASE_STATIC);
      const movingLayer = new Jolt.BroadPhaseLayer(BROAD_PHASE_MOVING);
      broadPhaseInterface.MapObjectToBroadPhaseLayer(
        OBJECT_LAYER_STATIC,
        staticLayer,
      );
      broadPhaseInterface.MapObjectToBroadPhaseLayer(
        OBJECT_LAYER_MOVING,
        movingLayer,
      );
      Jolt.destroy(staticLayer);
      Jolt.destroy(movingLayer);

      broadPhaseFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(
        broadPhaseInterface,
        BROAD_PHASE_LAYER_COUNT,
        objectFilter,
        OBJECT_LAYER_COUNT,
      );

      settings = new Jolt.JoltSettings();
      settings.mMaxBodies = 64;
      settings.mMaxBodyPairs = 256;
      settings.mMaxContactConstraints = 128;
      settings.mMaxWorkerThreads = 0;
      settings.mObjectLayerPairFilter = objectFilter;
      settings.mBroadPhaseLayerInterface = broadPhaseInterface;
      settings.mObjectVsBroadPhaseLayerFilter = broadPhaseFilter;

      this.jolt = new Jolt.JoltInterface(settings);
      ownershipTransferred = true;
    } finally {
      if (settings) Jolt.destroy(settings);
      if (!ownershipTransferred) {
        if (broadPhaseFilter) Jolt.destroy(broadPhaseFilter);
        if (broadPhaseInterface) Jolt.destroy(broadPhaseInterface);
        if (objectFilter) Jolt.destroy(objectFilter);
      }
    }

    this.physicsSystem = this.jolt.GetPhysicsSystem();
    this.bodyInterface = this.physicsSystem.GetBodyInterface();

    const gravity = new Jolt.Vec3(0, -9.81, 0);
    this.physicsSystem.SetGravity(gravity);
    Jolt.destroy(gravity);

    this.createScratchObjects();
    this.installContactListener();
    this.createField();
    this.createActors();
    this.physicsSystem.OptimizeBroadPhase();
    this.resetDribblerDemo();
  }

  private createScratchObjects(): void {
    const { Jolt } = this;
    this.dribblerPositionScratch = new Jolt.RVec3(0, 0, 0);
    this.dribblerRotationScratch = new Jolt.Quat(0, 0, 0, 1);
    this.forceScratch = new Jolt.Vec3(0, 0, 0);
    this.torqueScratch = new Jolt.Vec3(0, 0, 0);

    // ContactSettings stores body2 surface velocity minus body1 surface
    // velocity. These pairs are updated from robot orientation each substep.
    this.surfaceVelocityBody1Scratch = new Jolt.Vec3(
      0,
      ROLLER_SURFACE_SPEED,
      0,
    );
    this.surfaceVelocityBody2Scratch = new Jolt.Vec3(
      0,
      -ROLLER_SURFACE_SPEED,
      0,
    );
  }

  private installContactListener(): void {
    const { Jolt } = this;
    const physicsSystem = this.requirePhysicsSystem();
    const listener = new Jolt.ContactListenerJS();

    const configureContact = (
      body1Pointer: number,
      body2Pointer: number,
      settingsPointer: number,
    ): void => {
      const body1 = Jolt.wrapPointer(body1Pointer, Jolt.Body);
      const body2 = Jolt.wrapPointer(body2Pointer, Jolt.Body);
      const body1UserData = body1.GetUserData();
      const body2UserData = body2.GetUserData();
      const rollerIsBody1 =
        body1UserData === USER_DATA_DRIBBLER &&
        body2UserData === USER_DATA_BALL;
      const rollerIsBody2 =
        body2UserData === USER_DATA_DRIBBLER &&
        body1UserData === USER_DATA_BALL;

      if (!rollerIsBody1 && !rollerIsBody2) return;
      this.contactSeenThisStep = true;
      if (!this.dribblerActive) return;

      const contactSettings = Jolt.wrapPointer(
        settingsPointer,
        Jolt.ContactSettings,
      );
      contactSettings.mCombinedFriction = 1.2;
      contactSettings.mCombinedRestitution = 0;

      // Jolt expects (surface velocity of body 2 - surface velocity of body 1).
      // Therefore a roller in body 1 uses the inverse of its world velocity;
      // a roller in body 2 uses the velocity unchanged.
      contactSettings.mRelativeLinearSurfaceVelocity = rollerIsBody1
        ? this.surfaceVelocityBody1Scratch!
        : this.surfaceVelocityBody2Scratch!;
      // The belt is represented as a *linear* moving surface. Angular motor
      // compliance is modeled by the bounded torque helper below; setting both
      // here would over-constrain a ball already touching the floor.
    };

    listener.OnContactValidate = () =>
      Jolt.ValidateResult_AcceptAllContactsForThisBodyPair;
    listener.OnContactAdded = (body1, body2, _manifold, settings) => {
      configureContact(body1, body2, settings);
    };
    listener.OnContactPersisted = (body1, body2, _manifold, settings) => {
      configureContact(body1, body2, settings);
    };
    listener.OnContactRemoved = (subShapePairPointer) => {
      const pair = Jolt.wrapPointer(subShapePairPointer, Jolt.SubShapeIDPair);
      const body1 = pair.GetBody1ID().GetIndexAndSequenceNumber();
      const body2 = pair.GetBody2ID().GetIndexAndSequenceNumber();
      const ball = this.ballId?.GetIndexAndSequenceNumber();
      const roller = this.dribblerId?.GetIndexAndSequenceNumber();
      if (
        (body1 === ball && body2 === roller) ||
        (body1 === roller && body2 === ball)
      ) {
        this.contactSeenThisStep = false;
      }
    };

    physicsSystem.SetContactListener(listener);
    this.contactListener = listener;
  }

  private createField(): void {
    this.staticBodyIds.push(
      this.createBoxBody({
        halfExtents: [FIELD_WIDTH / 2, FLOOR_THICKNESS / 2, FIELD_LENGTH / 2],
        position: [0, -FLOOR_THICKNESS / 2, 0],
        userData: USER_DATA_FIELD,
        friction: 0.48,
        restitution: 0.05,
      }),
    );

    const halfWallHeight = WALL_HEIGHT / 2;
    const sideX = FIELD_WIDTH / 2 + WALL_THICKNESS / 2;
    const endZ = FIELD_LENGTH / 2 + WALL_THICKNESS / 2;

    this.staticBodyIds.push(
      this.createBoxBody({
        halfExtents: [WALL_THICKNESS / 2, halfWallHeight, FIELD_LENGTH / 2],
        position: [-sideX, halfWallHeight, 0],
        userData: USER_DATA_WALL,
        friction: 0.4,
        restitution: 0.24,
      }),
    );
    this.staticBodyIds.push(
      this.createBoxBody({
        halfExtents: [WALL_THICKNESS / 2, halfWallHeight, FIELD_LENGTH / 2],
        position: [sideX, halfWallHeight, 0],
        userData: USER_DATA_WALL,
        friction: 0.4,
        restitution: 0.24,
      }),
    );
    this.staticBodyIds.push(
      this.createBoxBody({
        halfExtents: [
          FIELD_WIDTH / 2 + WALL_THICKNESS,
          halfWallHeight,
          WALL_THICKNESS / 2,
        ],
        position: [0, halfWallHeight, -endZ],
        userData: USER_DATA_WALL,
        friction: 0.4,
        restitution: 0.24,
      }),
    );
    this.staticBodyIds.push(
      this.createBoxBody({
        halfExtents: [
          FIELD_WIDTH / 2 + WALL_THICKNESS,
          halfWallHeight,
          WALL_THICKNESS / 2,
        ],
        position: [0, halfWallHeight, endZ],
        userData: USER_DATA_WALL,
        friction: 0.4,
        restitution: 0.24,
      }),
    );
  }

  private createActors(): void {
    const { Jolt } = this;

    const ballShape = new Jolt.SphereShape(BALL_RADIUS);
    ballShape.SetDensity(BALL_MASS / ((4 / 3) * Math.PI * BALL_RADIUS ** 3));
    this.ballId = this.createBody({
      shape: ballShape,
      position: [0, BALL_RADIUS + 0.001, -0.28],
      motionType: Jolt.EMotionType_Dynamic,
      objectLayer: OBJECT_LAYER_MOVING,
      userData: USER_DATA_BALL,
      friction: 0.36,
      restitution: 0.16,
      linearDamping: 0.05,
      angularDamping: 0.04,
      motionQuality: Jolt.EMotionQuality_LinearCast,
      maxLinearVelocity: 8,
      maxAngularVelocity: 160,
    });

    const robotShape = new Jolt.CylinderShape(
      ROBOT_HALF_HEIGHT,
      ROBOT_RADIUS,
      0.002,
    );
    robotShape.SetDensity(
      ROBOT_MASS / (Math.PI * ROBOT_RADIUS ** 2 * (ROBOT_HALF_HEIGHT * 2)),
    );
    this.robotId = this.createBody({
      shape: robotShape,
      position: [0, ROBOT_HALF_HEIGHT + 0.004, -0.42],
      motionType: Jolt.EMotionType_Dynamic,
      objectLayer: OBJECT_LAYER_MOVING,
      userData: USER_DATA_ROBOT,
      friction: 0.82,
      restitution: 0.03,
      linearDamping: 0.25,
      angularDamping: 0.75,
      allowedDofs:
        Jolt.EAllowedDOFs_TranslationX |
        Jolt.EAllowedDOFs_TranslationZ |
        Jolt.EAllowedDOFs_RotationY,
      maxLinearVelocity: 2.5,
      maxAngularVelocity: 12,
    });

    const dribblerHalfExtents = new Jolt.Vec3(
      DRIBBLER_HALF_WIDTH,
      DRIBBLER_HALF_HEIGHT,
      DRIBBLER_HALF_DEPTH,
    );
    const dribblerShape = new Jolt.BoxShape(dribblerHalfExtents, 0.002);
    Jolt.destroy(dribblerHalfExtents);
    this.dribblerId = this.createBody({
      shape: dribblerShape,
      position: [0, BALL_RADIUS, -0.42 + DRIBBLER_CENTER_FORWARD],
      motionType: Jolt.EMotionType_Kinematic,
      objectLayer: OBJECT_LAYER_MOVING,
      userData: USER_DATA_DRIBBLER,
      friction: 1.15,
      restitution: 0,
      linearDamping: 0,
      angularDamping: 0,
      maxLinearVelocity: 3,
      maxAngularVelocity: 20,
    });
  }

  private createBoxBody(options: {
    halfExtents: [number, number, number];
    position: [number, number, number];
    userData: number;
    friction: number;
    restitution: number;
  }): BodyId {
    const { Jolt } = this;
    const halfExtents = new Jolt.Vec3(...options.halfExtents);
    const shape = new Jolt.BoxShape(halfExtents, 0.002);
    Jolt.destroy(halfExtents);

    return this.createBody({
      shape,
      position: options.position,
      motionType: Jolt.EMotionType_Static,
      objectLayer: OBJECT_LAYER_STATIC,
      userData: options.userData,
      friction: options.friction,
      restitution: options.restitution,
    });
  }

  private createBody(options: {
    shape: Shape;
    position: [number, number, number];
    motionType: number;
    objectLayer: number;
    userData: number;
    friction: number;
    restitution: number;
    linearDamping?: number;
    angularDamping?: number;
    motionQuality?: number;
    allowedDofs?: number;
    maxLinearVelocity?: number;
    maxAngularVelocity?: number;
  }): BodyId {
    const { Jolt } = this;
    const bodyInterface = this.requireBodyInterface();
    const position = new Jolt.RVec3(...options.position);
    const rotation = new Jolt.Quat(0, 0, 0, 1);
    const settings = new Jolt.BodyCreationSettings(
      options.shape,
      position,
      rotation,
      options.motionType,
      options.objectLayer,
    );

    Jolt.destroy(position);
    Jolt.destroy(rotation);

    settings.mUserData = options.userData;
    settings.mFriction = options.friction;
    settings.mRestitution = options.restitution;
    settings.mLinearDamping = options.linearDamping ?? 0;
    settings.mAngularDamping = options.angularDamping ?? 0;
    settings.mAllowSleeping = options.motionType === Jolt.EMotionType_Static;
    if (options.motionQuality !== undefined) {
      settings.mMotionQuality = options.motionQuality;
    }
    if (options.allowedDofs !== undefined) {
      settings.mAllowedDOFs = options.allowedDofs;
    }
    if (options.maxLinearVelocity !== undefined) {
      settings.mMaxLinearVelocity = options.maxLinearVelocity;
    }
    if (options.maxAngularVelocity !== undefined) {
      settings.mMaxAngularVelocity = options.maxAngularVelocity;
    }

    const body = bodyInterface.CreateBody(settings);
    Jolt.destroy(settings);
    const id = new Jolt.BodyID(body.GetID().GetIndexAndSequenceNumber());
    bodyInterface.AddBody(
      id,
      options.motionType === Jolt.EMotionType_Static
        ? Jolt.EActivation_DontActivate
        : Jolt.EActivation_Activate,
    );

    return id;
  }

  private applyRobotDriveController(): void {
    const bodyInterface = this.requireBodyInterface();
    const robotId = this.requireBodyId(this.robotId, 'robot');
    const position = bodyInterface.GetPosition(robotId);
    const rotation = bodyInterface.GetRotation(robotId);
    const velocity = bodyInterface.GetLinearVelocity(robotId);
    const basis = this.basisFromQuaternion(rotation);
    const forwardSpeed =
      velocity.GetX() * basis.forwardX + velocity.GetZ() * basis.forwardZ;
    const driveForce = clamp((DEMO_ROBOT_SPEED - forwardSpeed) * 7, -1.8, 1.8);
    const centeringForce = clamp(
      -position.GetX() * 5 - velocity.GetX() * 1.8,
      -0.7,
      0.7,
    );

    this.forceScratch!.Set(
      basis.forwardX * driveForce + centeringForce,
      0,
      basis.forwardZ * driveForce,
    );
    bodyInterface.AddForce(
      robotId,
      this.forceScratch!,
      this.Jolt.EActivation_Activate,
    );
  }

  private moveDribblerWithRobot(deltaSeconds: number): void {
    const bodyInterface = this.requireBodyInterface();
    const robotId = this.requireBodyId(this.robotId, 'robot');
    const dribblerId = this.requireBodyId(this.dribblerId, 'dribbler');
    const robotPosition = bodyInterface.GetPosition(robotId);
    const robotRotation = bodyInterface.GetRotation(robotId);
    const robotVelocity = bodyInterface.GetLinearVelocity(robotId);
    const basis = this.basisFromQuaternion(robotRotation);

    this.dribblerPositionScratch!.Set(
      robotPosition.GetX() +
        robotVelocity.GetX() * deltaSeconds +
        basis.forwardX * DRIBBLER_CENTER_FORWARD,
      BALL_RADIUS,
      robotPosition.GetZ() +
        robotVelocity.GetZ() * deltaSeconds +
        basis.forwardZ * DRIBBLER_CENTER_FORWARD,
    );
    this.dribblerRotationScratch!.Set(
      robotRotation.GetX(),
      robotRotation.GetY(),
      robotRotation.GetZ(),
      robotRotation.GetW(),
    );

    bodyInterface.MoveKinematic(
      dribblerId,
      this.dribblerPositionScratch!,
      this.dribblerRotationScratch!,
      deltaSeconds,
    );

    // Roller surface moves down at the front face.
    this.surfaceVelocityBody1Scratch!.Set(0, ROLLER_SURFACE_SPEED, 0);
    this.surfaceVelocityBody2Scratch!.Set(0, -ROLLER_SURFACE_SPEED, 0);
  }

  private applyReducedOrderDribbler(): void {
    if (!this.dribblerActive) {
      this.lastHelperForceN = 0;
      return;
    }

    const bodyInterface = this.requireBodyInterface();
    const robotId = this.requireBodyId(this.robotId, 'robot');
    const ballId = this.requireBodyId(this.ballId, 'ball');
    const robotRotation = bodyInterface.GetRotation(robotId);
    const basis = this.basisFromQuaternion(robotRotation);
    // Jolt's convenience getters reuse temporary WASM objects. Copy every
    // component before invoking the same getter again for a different body.
    const robotPosition = this.readPositionComponents(robotId);
    const ballPosition = this.readPositionComponents(ballId);
    const robotVelocity = this.readLinearVelocityComponents(robotId);
    const ballVelocity = this.readLinearVelocityComponents(ballId);
    const ballAngularVelocity = this.readAngularVelocityComponents(ballId);

    const relativeX = ballPosition.x - robotPosition.x;
    const relativeZ = ballPosition.z - robotPosition.z;
    const forwardDistance =
      relativeX * basis.forwardX + relativeZ * basis.forwardZ;
    const lateralOffset = relativeX * basis.rightX + relativeZ * basis.rightZ;
    const inCaptureEnvelope =
      forwardDistance > DRIBBLER_FACE_FORWARD - 0.012 &&
      forwardDistance < DRIBBLER_FACE_FORWARD + BALL_RADIUS + 0.085 &&
      Math.abs(lateralOffset) < DRIBBLER_HALF_WIDTH + BALL_RADIUS * 0.35 &&
      ballPosition.y < BALL_RADIUS * 2.8;

    if (!inCaptureEnvelope) {
      this.lastHelperForceN = 0;
      return;
    }

    const relativeVelocityX = ballVelocity.x - robotVelocity.x;
    const relativeVelocityZ = ballVelocity.z - robotVelocity.z;
    const forwardVelocity =
      relativeVelocityX * basis.forwardX + relativeVelocityZ * basis.forwardZ;
    const lateralVelocity =
      relativeVelocityX * basis.rightX + relativeVelocityZ * basis.rightZ;

    let forwardForce =
      (TARGET_BALL_FORWARD - forwardDistance) * DRIBBLER_SPRING -
      forwardVelocity * DRIBBLER_DAMPING;
    let lateralForce =
      -lateralOffset * DRIBBLER_LATERAL_SPRING -
      lateralVelocity * DRIBBLER_LATERAL_DAMPING;
    const unboundedMagnitude = Math.hypot(forwardForce, lateralForce);
    if (unboundedMagnitude > DRIBBLER_MAX_FORCE) {
      const scale = DRIBBLER_MAX_FORCE / unboundedMagnitude;
      forwardForce *= scale;
      lateralForce *= scale;
    }

    const forceX = basis.forwardX * forwardForce + basis.rightX * lateralForce;
    const forceZ = basis.forwardZ * forwardForce + basis.rightZ * lateralForce;
    this.lastHelperForceN = Math.hypot(forceX, forceZ);
    this.forceScratch!.Set(forceX, 0, forceZ);
    bodyInterface.AddForce(
      ballId,
      this.forceScratch!,
      this.Jolt.EActivation_Activate,
    );

    const backspin =
      ballAngularVelocity.x * basis.rightX +
      ballAngularVelocity.z * basis.rightZ;
    const torque = clamp(
      (TARGET_BACKSPIN - backspin) * DRIBBLER_BACKSPIN_GAIN,
      -DRIBBLER_MAX_TORQUE,
      DRIBBLER_MAX_TORQUE,
    );
    this.torqueScratch!.Set(basis.rightX * torque, 0, basis.rightZ * torque);
    bodyInterface.AddTorque(
      ballId,
      this.torqueScratch!,
      this.Jolt.EActivation_Activate,
    );
  }

  private updateDribblerMetrics(): void {
    const bodyInterface = this.requireBodyInterface();
    const robotId = this.requireBodyId(this.robotId, 'robot');
    const ballId = this.requireBodyId(this.ballId, 'ball');
    const robotRotation = bodyInterface.GetRotation(robotId);
    const basis = this.basisFromQuaternion(robotRotation);
    const robotPosition = this.readPositionComponents(robotId);
    const ballPosition = this.readPositionComponents(ballId);
    const ballAngularVelocity = this.readAngularVelocityComponents(ballId);
    const relativeX = ballPosition.x - robotPosition.x;
    const relativeZ = ballPosition.z - robotPosition.z;

    this.lastBallForwardDistance =
      relativeX * basis.forwardX + relativeZ * basis.forwardZ;
    this.lastLateralOffset =
      relativeX * basis.rightX + relativeZ * basis.rightZ;
    this.lastCaptureDepth = Math.max(
      0,
      CAPTURE_PLANE_FORWARD - (this.lastBallForwardDistance - BALL_RADIUS),
    );
    this.lastBallBackspin =
      ballAngularVelocity.x * basis.rightX +
      ballAngularVelocity.z * basis.rightZ;
  }

  private readPositionComponents(bodyId: BodyId): PhysicsVector3 {
    const position = this.requireBodyInterface().GetPosition(bodyId);
    return {
      x: position.GetX(),
      y: position.GetY(),
      z: position.GetZ(),
    };
  }

  private readLinearVelocityComponents(bodyId: BodyId): PhysicsVector3 {
    const velocity = this.requireBodyInterface().GetLinearVelocity(bodyId);
    return {
      x: velocity.GetX(),
      y: velocity.GetY(),
      z: velocity.GetZ(),
    };
  }

  private readAngularVelocityComponents(bodyId: BodyId): PhysicsVector3 {
    const velocity = this.requireBodyInterface().GetAngularVelocity(bodyId);
    return {
      x: velocity.GetX(),
      y: velocity.GetY(),
      z: velocity.GetZ(),
    };
  }

  private readBody(bodyId: BodyId): PhysicsBodySnapshot {
    const bodyInterface = this.requireBodyInterface();
    const position = bodyInterface.GetPosition(bodyId);
    const positionSnapshot = {
      x: position.GetX(),
      y: position.GetY(),
      z: position.GetZ(),
    };
    const rotation = bodyInterface.GetRotation(bodyId);
    const rotationSnapshot = {
      x: rotation.GetX(),
      y: rotation.GetY(),
      z: rotation.GetZ(),
      w: rotation.GetW(),
    };
    const linearVelocity = bodyInterface.GetLinearVelocity(bodyId);
    const linearVelocitySnapshot = {
      x: linearVelocity.GetX(),
      y: linearVelocity.GetY(),
      z: linearVelocity.GetZ(),
    };
    const angularVelocity = bodyInterface.GetAngularVelocity(bodyId);

    return {
      position: positionSnapshot,
      rotation: rotationSnapshot,
      linearVelocity: linearVelocitySnapshot,
      angularVelocity: {
        x: angularVelocity.GetX(),
        y: angularVelocity.GetY(),
        z: angularVelocity.GetZ(),
      },
    };
  }

  private basisFromQuaternion(rotation: Quat): {
    forwardX: number;
    forwardZ: number;
    rightX: number;
    rightZ: number;
  } {
    const x = rotation.GetX();
    const y = rotation.GetY();
    const z = rotation.GetZ();
    const w = rotation.GetW();
    const forwardX = 2 * (x * z + w * y);
    const forwardZ = 1 - 2 * (x * x + y * y);
    const length = Math.hypot(forwardX, forwardZ) || 1;
    const normalizedForwardX = forwardX / length;
    const normalizedForwardZ = forwardZ / length;

    return {
      forwardX: normalizedForwardX,
      forwardZ: normalizedForwardZ,
      rightX: normalizedForwardZ,
      rightZ: -normalizedForwardX,
    };
  }

  private assertReady(): void {
    if (
      this.disposed ||
      !this.jolt ||
      !this.physicsSystem ||
      !this.bodyInterface
    ) {
      throw new Error(
        'RCJ Jolt physics world is not available or has been disposed.',
      );
    }
  }

  private requirePhysicsSystem(): PhysicsSystem {
    this.assertReady();
    return this.physicsSystem!;
  }

  private requireBodyInterface(): BodyInterface {
    this.assertReady();
    return this.bodyInterface!;
  }

  private requireBodyId(bodyId: BodyId | null, label: string): BodyId {
    if (!bodyId) {
      throw new Error(`RCJ Jolt physics ${label} body is not initialized.`);
    }
    return bodyId;
  }
}

export async function createRcjJoltWorld(): Promise<RcjJoltWorld> {
  return RcjJoltWorld.create();
}

/** Lightweight capability probe used by the shell before enabling live physics. */
export async function probeJoltSupport(): Promise<boolean> {
  let world: RcjJoltWorld | null = null;
  try {
    world = await RcjJoltWorld.create();
    return true;
  } catch {
    return false;
  } finally {
    world?.dispose();
  }
}
