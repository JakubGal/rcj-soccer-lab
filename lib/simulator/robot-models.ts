/** Browser-ready robot visuals available in the simulator. */
export const ROBOT_VISUALS = [
  {
    id: 'lab',
    label: 'Lab proxy',
    assetPath: null,
    markerHeight: 0.158,
  },
  {
    id: 'xlc-open-2020',
    label: 'XLC Open 2020',
    assetPath: 'models/robots/xlc-open-2020.glb',
    assetRevision: '65e95596d8c8',
    markerHeight: 0.212,
  },
  {
    id: 'xlc-innovation-2021',
    label: 'XLC Innovation 2021',
    assetPath: 'models/robots/xlc-innovation-2021.glb',
    markerHeight: 0.188,
  },
] as const;

export type RobotVisual = (typeof ROBOT_VISUALS)[number];
export type RobotVisualId = RobotVisual['id'];

export const DEFAULT_ROBOT_VISUAL_ID: RobotVisualId = 'xlc-innovation-2021';

export function isRobotVisualId(value: unknown): value is RobotVisualId {
  return ROBOT_VISUALS.some((visual) => visual.id === value);
}

export function getRobotVisual(id: RobotVisualId): RobotVisual {
  return ROBOT_VISUALS.find((visual) => visual.id === id) ?? ROBOT_VISUALS[0];
}
