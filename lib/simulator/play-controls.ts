import type {
  DriveInput,
  MatchSettings,
  MatchTeam,
  TeamControl,
} from './match';

export type PlayControlScheme = 'single' | 'blue' | 'yellow';

export const PLAY_BINDINGS = {
  single: {
    forward: 'KeyW',
    backward: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    turnLeft: 'KeyQ',
    turnRight: 'KeyE',
    kick: 'Space',
    switchRobot: 'KeyC',
  },
  blue: {
    forward: 'KeyW',
    backward: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    turnLeft: 'KeyQ',
    turnRight: 'KeyE',
    kick: 'Space',
    switchRobot: 'KeyC',
  },
  yellow: {
    forward: 'ArrowUp',
    backward: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    turnLeft: 'Comma',
    turnRight: 'Period',
    kick: 'Enter',
    switchRobot: 'Slash',
  },
} as const;

/** Independent channels in two-player mode; keep arrow aliases for solo play. */
export function playDriveInput(
  down: (code: string) => boolean,
  scheme: PlayControlScheme,
  dribble: boolean,
): DriveInput {
  const keys = PLAY_BINDINGS[scheme];
  const pressed = (key: keyof typeof keys, alias: string) =>
    down(keys[key]) || (scheme === 'single' && down(alias));
  return {
    forward:
      Number(pressed('forward', 'ArrowUp')) -
      Number(pressed('backward', 'ArrowDown')),
    strafe:
      Number(pressed('right', 'ArrowRight')) -
      Number(pressed('left', 'ArrowLeft')),
    turn: Number(down(keys.turnRight)) - Number(down(keys.turnLeft)),
    kick: down(keys.kick),
    dribble,
  };
}

export function playDriveKeys(twoPlayer: boolean): ReadonlySet<string> {
  return new Set([
    ...Object.values(PLAY_BINDINGS.single),
    ...Object.values(PLAY_BINDINGS.yellow).filter(
      (code) => twoPlayer || code.startsWith('Arrow'),
    ),
  ]);
}

export function playerKeys(team: 'blue' | 'yellow'): ReadonlySet<string> {
  return new Set(Object.values(PLAY_BINDINGS[team]));
}

/** Keep the remaining human selected when leaving local multiplayer. */
export function withPlayTeamControl(
  settings: MatchSettings,
  humanRobots: Record<MatchTeam, string>,
  team: MatchTeam,
  control: TeamControl,
): MatchSettings {
  const controls = { ...settings.controls, [team]: control };
  const selectedTeam = settings.selectedRobot.startsWith('blue-')
    ? 'blue'
    : 'yellow';
  const otherTeam = selectedTeam === 'blue' ? 'yellow' : 'blue';
  const selectedRobot =
    control === 'manual'
      ? humanRobots[team]
      : controls[selectedTeam] === 'manual'
        ? settings.selectedRobot
        : controls[otherTeam] === 'manual'
          ? humanRobots[otherTeam]
          : settings.selectedRobot;
  return { ...settings, controls, selectedRobot };
}

/** Never steal typing, native activation, or arrow navigation from a control. */
export function isPlayControlTarget(target: EventTarget | null): boolean {
  return Boolean(
    target &&
    'closest' in target &&
    typeof target.closest === 'function' &&
    target.closest(
      'input, select, textarea, button, a, [contenteditable]:not([contenteditable="false"]), [role="switch"], [role="slider"], [role="combobox"]',
    ),
  );
}
