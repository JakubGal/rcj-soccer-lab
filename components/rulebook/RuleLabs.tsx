'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Check, ChevronRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { LabRange } from './InspectionWorkbench';
import { RuleAnimationPlayer } from './RuleAnimationPlayer';
import { pose, type RuleClip } from '@/lib/rulebook/animations';
import { tournamentPoints } from '@/lib/rulebook/scoring';
import { RCJ_FIELD_DERIVED as FIELD } from '@/lib/simulator/field-spec';
import type { RobotVisualId } from '@/lib/simulator/robot-models';
import { cn } from '@/lib/utils';

export function KickerWorkbench({
  robotVisual,
}: {
  robotVisual: RobotVisualId;
}) {
  const [rebound, setRebound] = useState(70);
  const clips = useMemo(
    (): RuleClip[] => [
      {
        id: 'kicker-lab',
        title: 'Adjust the rebound',
        anchor: 'kicker-power-measuring',
        question: 'Does this illustrated test pass?',
        options: ['Passes', 'Does not pass'],
        answer: rebound < 100 ? 0 : 1,
        feedback:
          rebound < 100
            ? 'The returning ball stops before the starting back wall.'
            : 'The returning ball reaches the starting back wall.',
        frames: [
          {
            at: 0,
            label: 'Robot at the starting goal back wall',
            poses: {
              'blue-1': pose(0, -FIELD.goalBackInnerFaceZ + 0.1),
              'blue-2': null,
              'yellow-1': null,
              'yellow-2': null,
              ball: pose(0, -0.925),
            },
            readout: 'Main leagues · illustrative test path',
          },
          { at: 1, label: 'Kick toward the opposite goal' },
          {
            at: 3,
            label: 'Opposite back-wall contact',
            poses: {
              'blue-1': null,
              ball: pose(0, FIELD.goalBackContactBallCenterZ, 50),
            },
            readout: 'Robot hidden to expose return path',
          },
          {
            at: 5.5,
            label:
              rebound < 100
                ? 'Rebound stops short'
                : 'Rebound reaches the starting wall',
            poses: {
              ball: pose(
                0,
                FIELD.goalBackContactBallCenterZ *
                  (1 - (2 * Math.min(100, rebound)) / 100),
                85,
              ),
            },
          },
          {
            at: 6.5,
            label:
              rebound < 100
                ? 'Illustrated outcome: pass'
                : 'Illustrated outcome: adjust kicker',
            readout: 'Use the real tournament ball and field',
          },
        ],
      },
    ],
    [rebound],
  );
  return (
    <section className="rule-lab">
      <div className="lab-heading">
        <div>
          <h2>Kicker test bench</h2>
          <p>Compare rebound outcomes; this is a geometric teaching model.</p>
        </div>
      </div>
      <div className="lab-segmented">
        <Button variant="outline" onClick={() => setRebound(65)}>
          Stops short
        </Button>
        <Button variant="outline" onClick={() => setRebound(100)}>
          Touches starting wall
        </Button>
        <Button variant="outline" onClick={() => setRebound(90)}>
          Close to the limit
        </Button>
      </div>
      <LabRange
        label="Return distance across the goal-to-goal span"
        value={rebound}
        min={20}
        max={100}
        unit="%"
        onChange={setRebound}
      />
      <RuleAnimationPlayer clips={clips} robotVisual={robotVisual} />
      <p className="rule-small">
        There is no universal speed setting here. Wall rebound changes the real
        test. The main-league procedure is not substituted for the separate
        Entry appendix.
      </p>
    </section>
  );
}

const FIELD_FEATURES = [
  {
    id: 'floor',
    label: 'Floor',
    value: '182 × 243 cm',
    note: 'Playing rectangle: 158 × 219 cm.',
    anchor: 'dimensions-of-the-field',
  },
  {
    id: 'walls',
    label: 'Walls',
    value: '22 cm high',
    note: 'The physical wall surrounds the outer strip.',
    anchor: 'field-walls',
  },
  {
    id: 'goal',
    label: 'Goals',
    value: '60 × 10 × 7.4 cm',
    note: 'Width × height × internal depth.',
    anchor: 'goals',
  },
  {
    id: 'spots',
    label: 'Neutral spots',
    value: '5 marked positions',
    note: 'Center plus four neutral spots.',
    anchor: 'neutral-spots',
  },
  {
    id: 'area',
    label: 'Penalty areas',
    value: '80 × 25 cm',
    note: 'Rounded front corners: radius 15 cm.',
    anchor: 'penalty-areas',
  },
  {
    id: 'circle',
    label: 'Center circle',
    value: '60 cm diameter',
    note: 'Radius 30 cm.',
    anchor: 'center-circle',
  },
  {
    id: 'ramp',
    label: 'Return wedges',
    value: '10 cm run · 2 cm rise',
    note: 'Rise tolerance ±1 cm; goal pockets remain flat.',
    anchor: 'dimensions-of-the-field',
  },
];

export function FieldWorkbench({
  onRule,
}: {
  onRule: (document: string, anchor: string) => void;
}) {
  const [feature, setFeature] = useState('spots');
  const selected = FIELD_FEATURES.find((item) => item.id === feature)!;
  const accent = (id: string) => (id === feature ? '#67e8f9' : '#d4e7d9');
  return (
    <section className="rule-lab">
      <h2>Explore the field</h2>
      <p className="rule-small">Select a feature to highlight its geometry.</p>
      <svg
        className="field-diagram"
        viewBox="0 0 360 430"
        aria-label={`Field diagram highlighting ${selected.label}`}
      >
        <rect
          x="60"
          y="40"
          width="240"
          height="320.4"
          fill="#1c563f"
          stroke={accent('walls')}
          strokeWidth={feature === 'walls' ? 6 : 3}
        />
        <rect
          x="75.8"
          y="55.8"
          width="208.4"
          height="288.7"
          fill="none"
          stroke={accent('floor')}
          strokeWidth="2.64"
        />
        <path
          d="M60 55 H300 M60 345 H300 M75 40 V360 M285 40 V360"
          stroke={feature === 'ramp' ? '#67e8f9' : '#347351'}
          strokeWidth="9"
          opacity="0.55"
        />
        <line x1="76" y1="200" x2="284" y2="200" stroke="#bddfc7" />
        <circle
          cx="180"
          cy="200"
          r="39.56"
          fill="none"
          stroke={accent('circle')}
          strokeWidth={feature === 'circle' ? 3 : 1}
        />
        <path
          d="M127.25 58.4 V71.6 Q127.25 91.4 147 91.4 H213 Q232.75 91.4 232.75 71.6 V58.4 M127.25 341.8 V328.6 Q127.25 308.8 147 308.8 H213 Q232.75 308.8 232.75 328.6 V341.8"
          fill={feature === 'area' ? '#67e8f930' : 'none'}
          stroke={accent('area')}
          strokeWidth="2.64"
        />
        <rect
          x="140.44"
          y="48.6"
          width="79.12"
          height="9.8"
          fill="#e9c550"
          stroke={accent('goal')}
          strokeWidth="2"
        />
        <rect
          x="140.44"
          y="341.8"
          width="79.12"
          height="9.8"
          fill="#47a2e5"
          stroke={accent('goal')}
          strokeWidth="2"
        />
        {[
          [180, 200],
          [128.57, 114.94],
          [231.43, 114.94],
          [128.57, 285.06],
          [231.43, 285.06],
        ].map(([x, y], index) => (
          <g key={index}>
            <circle
              cx={x}
              cy={y}
              r={feature === 'spots' ? 7 : 2}
              fill={accent('spots')}
            />
            {feature === 'spots' && (
              <text x={x + 11} y={y + 5} fill="#e6f8ff" fontSize="14">
                {index + 1}
              </text>
            )}
          </g>
        ))}
        <text x="180" y="25" textAnchor="middle" fill="#d7e7f1" fontSize="15">
          182 cm
        </text>
        <text
          x="26"
          y="205"
          textAnchor="middle"
          fill="#d7e7f1"
          fontSize="14"
          transform="rotate(-90 26 205)"
        >
          243 cm
        </text>
        <text x="180" y="396" textAnchor="middle" fill="#67e8f9" fontSize="16">
          {selected.value}
        </text>
      </svg>
      <div className="lab-segmented">
        {FIELD_FEATURES.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={feature === item.id ? 'secondary' : 'outline'}
            aria-pressed={feature === item.id}
            onClick={() => setFeature(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div className="lab-fact">
        <strong>
          {selected.label} · {selected.value}
        </strong>
        <p>{selected.note}</p>
        <Button
          variant="ghost"
          onClick={() => onRule('field', selected.anchor)}
        >
          Read specification <ChevronRight />
        </Button>
      </div>
    </section>
  );
}

export function BallWorkbench() {
  const [large, setLarge] = useState(false);
  const [overlay, setOverlay] = useState(true);
  return (
    <section className="rule-lab">
      <h2>Compare the balls</h2>
      <div className="lab-segmented">
        <Button
          variant={!large ? 'secondary' : 'outline'}
          aria-pressed={!large}
          onClick={() => setLarge(false)}
        >
          Main leagues · 42 mm
        </Button>
        <Button
          variant={large ? 'secondary' : 'outline'}
          aria-pressed={large}
          onClick={() => setLarge(true)}
        >
          Large / Entry · 74 mm
        </Button>
      </div>
      <svg
        className="ball-diagram"
        viewBox="0 0 440 260"
        aria-label={`${large ? 74 : 42} millimetre ball compared at the same scale`}
      >
        <rect width="440" height="260" fill="#0a1721" />
        <line x1="30" x2="410" y1="212" y2="212" stroke="#5b768b" />
        {overlay && (
          <circle
            cx="220"
            cy={212 - (large ? 42 : 74)}
            r={large ? 42 : 74}
            fill="none"
            stroke="#67e8f9"
            strokeDasharray="6 5"
          />
        )}
        <circle
          cx="220"
          cy={212 - (large ? 74 : 42)}
          r={large ? 74 : 42}
          fill="#f29239"
          stroke="#ffcd9a"
          strokeWidth="2"
        />
        <text
          x="220"
          y={216 - (large ? 74 : 42)}
          textAnchor="middle"
          fill="#3d210c"
          fontSize="20"
        >
          Ø {large ? 74 : 42} mm
        </text>
        <text x="220" y="32" textAnchor="middle" fill="#d6e6f0" fontSize="15">
          Same scale · diameters, not volumes
        </text>
      </svg>
      <label className="lab-check-line" htmlFor="ball-overlay">
        <Checkbox
          id="ball-overlay"
          checked={overlay}
          onCheckedChange={(next) => setOverlay(Boolean(next))}
        />
        Show the other diameter
      </label>
      <p className="rule-source-note">
        The ball specification retains older large-ball details. Main 2026
        Infrared uses the small ball; Entry keeps its separate specification.
        Read the selected section’s context.
      </p>
    </section>
  );
}

const JUDGING = [
  { key: 'tdp', label: 'TDP base grade', values: [0, 1, 3, 5] },
  { key: 'poster', label: 'Poster', values: [0, 1, 3, 5] },
  { key: 'interview', label: 'Interview', values: [0, 1, 3, 5] },
  { key: 'sportsmanship', label: 'Sportsmanship', values: [0, 1, 2, 3] },
  { key: 'sharing', label: 'Documentation & community', values: [0, 1, 3, 5] },
  { key: 'video', label: 'Short video', values: [0, 1] },
];
const GRADES = ['Developing', 'Satisfactory', 'Proficient', 'Excellent'];
const TDP_BONUSES = [
  { id: 'hardware', label: 'Published CAD, PCB and schematic files' },
  { id: 'software', label: 'Published software repositories' },
];
export function ScoringWorkbench() {
  const [place, setPlace] = useState(5);
  const [scores, setScores] = useState<Record<string, number>>({
    tdp: 3,
    poster: 3,
    interview: 3,
    sportsmanship: 2,
    sharing: 3,
    video: 1,
  });
  const [community, setCommunity] = useState(false);
  const [bonuses, setBonuses] = useState<string[]>([]);
  const game = tournamentPoints(place);
  const total =
    game +
    Object.values(scores).reduce((sum, value) => sum + value, 0) +
    bonuses.length +
    Number(community);
  return (
    <section className="rule-lab">
      <div className="lab-heading">
        <div>
          <h2>Ranking score explorer</h2>
          <p>Try hypothetical results across the judging categories.</p>
        </div>
        <output className="score-total">
          {total}
          <small>points</small>
        </output>
      </div>
      <div
        className="ranking-stack"
        aria-label={`Hypothetical overall score ${total}`}
      >
        <span style={{ flex: game }} title={`Gameplay: ${game}`} />
        {JUDGING.map((item, index) => (
          <span
            key={item.key}
            style={{
              flex:
                scores[item.key] + (item.key === 'tdp' ? bonuses.length : 0),
              background: [
                '#a78bfa',
                '#fbbf24',
                '#2dd4bf',
                '#fb7185',
                '#60a5fa',
                '#e879f9',
              ][index],
            }}
            title={`${item.label}: ${scores[item.key]}${item.key === 'tdp' ? ` + ${bonuses.length} bonus` : ''}`}
          />
        ))}
        {community && (
          <span
            style={{ flex: 1, background: '#bef264' }}
            title="Community Award: 1"
          />
        )}
      </div>
      <LabRange
        label={`Tournament place · ${game} points`}
        value={place}
        min={1}
        max={30}
        onChange={setPlace}
      />
      {JUDGING.map((item) => (
        <div key={item.key} className="lab-grade">
          <label htmlFor={`grade-${item.key}`}>{item.label}</label>
          <NativeSelect
            id={`grade-${item.key}`}
            value={scores[item.key]}
            onChange={(event) =>
              setScores((current) => ({
                ...current,
                [item.key]: Number(event.target.value),
              }))
            }
          >
            {item.values.map((value, index) => (
              <NativeSelectOption key={value} value={value}>
                {GRADES[index]} · {value} {value === 1 ? 'point' : 'points'}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      ))}
      <h3 className="lab-subheading">TDP bonuses · 1 point each</h3>
      {TDP_BONUSES.map((bonus) => (
        <label
          key={bonus.id}
          className="lab-check-line"
          htmlFor={`bonus-${bonus.id}`}
        >
          <Checkbox
            id={`bonus-${bonus.id}`}
            checked={bonuses.includes(bonus.id)}
            onCheckedChange={(next) =>
              setBonuses((current) =>
                next
                  ? [...new Set([...current, bonus.id])]
                  : current.filter((id) => id !== bonus.id),
              )
            }
          />
          {bonus.label}
        </label>
      ))}
      <label className="lab-check-line" htmlFor="community-point">
        <Checkbox
          id="community-point"
          checked={community}
          onCheckedChange={(next) => setCommunity(Boolean(next))}
        />
        Community award point
      </label>
      <p className="rule-small">
        Explore totals, not predicted judging grades. The official rubrics
        determine eligible levels and bonuses. Tournament placement breaks an
        overall-score tie.
      </p>
      <p className="rule-source-note">
        Poster measurements differ between the General Rules and judging
        document. Confirm the event’s poster brief rather than treating this
        explorer as a size certificate.
      </p>
    </section>
  );
}

const PREPARATION = {
  team: [
    'Assign roles to team members',
    'Check ages and event team-size allowance',
    'Confirm mentor and onsite attendance',
    'Confirm qualification with the regional representative',
  ],
  documentation: [
    'Describe one original design choice',
    'Show test evidence and iterations',
    'List reused work and its authors',
    'Prepare the BOM and sharing links',
    'Check event submission formats and deadlines',
  ],
  competition: [
    'Read event-specific communications',
    'Plan the setup-day interview',
    'Prepare for an unseen technical task',
    'Coordinate with SuperTeam partners',
  ],
  conduct: [
    'Separate observed facts from assumptions',
    'Ask the designated official',
    'Resolve the issue before signing results',
    'Record a constructive clarification for the team',
  ],
};
const PROMPTS = [
  {
    title: 'Explain your design',
    prompt:
      'Choose one sensor. Explain how its readings change a motor command.',
    hint: 'Connect a measurement, a decision, and an action.',
  },
  {
    title: 'Show your evidence',
    prompt: 'Compare one failed test with the modification that improved it.',
    hint: 'Use a graph, photograph, log, or repeatable demonstration.',
  },
  {
    title: 'Acknowledge reused work',
    prompt:
      'Point to one external library or mechanism and identify your own contribution.',
    hint: 'Make the origin and the adaptation clear.',
  },
  {
    title: 'Work as a team',
    prompt:
      'Give each member a part of a short robot demonstration to explain.',
    hint: 'Practice the handoffs; avoid relying on one spokesperson.',
  },
];
export function ReadinessWorkbench({
  category,
}: {
  category: keyof typeof PREPARATION;
}) {
  const [checked, setChecked] = useState<string[]>([]);
  const [card, setCard] = useState(0);
  const [reveal, setReveal] = useState(false);
  const items = PREPARATION[category];
  return (
    <section className="rule-lab">
      <h2>
        {
          {
            team: 'Team preparation',
            documentation: 'Documentation desk',
            competition: 'Competition preparation',
            conduct: 'Resolve a situation',
          }[category]
        }
      </h2>
      <p className="rule-small">
        Use these study prompts while reading the complete requirements.
      </p>
      <div className="readiness-flow">
        {items.map((item, index) => (
          <label
            key={item}
            htmlFor={`ready-${category}-${index}`}
            className={cn(checked.includes(item) && 'readiness-done')}
          >
            <span>{checked.includes(item) ? <Check /> : index + 1}</span>
            <Checkbox
              id={`ready-${category}-${index}`}
              checked={checked.includes(item)}
              onCheckedChange={(next) =>
                setChecked((current) =>
                  next
                    ? [...new Set([...current, item])]
                    : current.filter((value) => value !== item),
                )
              }
            />
            {item}
          </label>
        ))}
      </div>
      <output className="lab-status">
        {items.filter((item) => checked.includes(item)).length} / {items.length}{' '}
        preparation steps checked
      </output>
      <div className="interview-card">
        <span className="rule-kicker">
          Practice card {card + 1} / {PROMPTS.length}
        </span>
        <h3>{PROMPTS[card].title}</h3>
        <p>{PROMPTS[card].prompt}</p>
        {reveal && <output>{PROMPTS[card].hint}</output>}
        <div>
          <Button
            variant="outline"
            onClick={() => setReveal((value) => !value)}
          >
            {reveal ? 'Hide prompt' : 'Show a thinking prompt'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setCard((current) => (current + 1) % PROMPTS.length);
              setReveal(false);
            }}
          >
            Next card <ArrowRight />
          </Button>
        </div>
      </div>
      <p className="rule-small">
        Practice prompts are authored learning aids, not the official interview
        questions or an assessment result.
      </p>
    </section>
  );
}

export function DecisionWorkbench() {
  const [step, setStep] = useState(0);
  const steps = [
    'Observe the situation',
    'Speak through the designated team member',
    'Clarify the decision with the referee',
    'Settle the dispute before signing',
  ];
  return (
    <section className="rule-lab">
      <h2>Follow a decision</h2>
      <div className="decision-path">
        {steps.map((label, index) => (
          <Button
            key={label}
            variant={step === index ? 'secondary' : 'outline'}
            onClick={() => setStep(index)}
            aria-pressed={step === index}
          >
            <span>{index + 1}</span>
            {label}
            {index < steps.length - 1 && <ChevronRight />}
          </Button>
        ))}
      </div>
      <div className="lab-fact">
        <h3>{steps[step]}</h3>
        <p>
          {
            [
              'Identify the robots, ball position, and sequence of events. Replay an example if useful.',
              'Choose the team representative instead of surrounding the official.',
              'Present observations and ask which rule applies. Check the official text beside this guide.',
              'Review the result and any unresolved question before adding signatures.',
            ][step]
          }
        </p>
        <Button
          onClick={() => setStep((current) => (current + 1) % steps.length)}
        >
          {step === 3 ? <RotateCcw /> : <ArrowRight />}
          {step === 3 ? 'Try again' : 'Continue'}
        </Button>
      </div>
    </section>
  );
}

export function CompanionWorkbench({
  document,
  onDocument,
}: {
  document: 'entry' | 'superteam';
  onDocument: (id: string) => void;
}) {
  const [choice, setChoice] = useState('format');
  return (
    <section className="rule-lab">
      <h2>
        {document === 'entry' ? 'Entry league context' : 'SuperTeam context'}
      </h2>
      <div className="lab-segmented">
        {['format', 'equipment', 'event'].map((id) => (
          <Button
            key={id}
            variant={choice === id ? 'secondary' : 'outline'}
            onClick={() => setChoice(id)}
          >
            {
              {
                format: 'Game format',
                equipment: 'Equipment',
                event: 'Your event',
              }[id]
            }
          </Button>
        ))}
      </div>
      <div
        className="format-diagram"
        aria-label={
          document === 'entry'
            ? 'One robot versus one robot'
            : 'Five robots versus five robots'
        }
      >
        {['blue', 'yellow'].map((team) => (
          <div key={team} className={team}>
            {Array.from(
              { length: document === 'entry' ? 1 : 5 },
              (_, index) => (
                <span key={index}>{index + 1}</span>
              ),
            )}
          </div>
        ))}
      </div>
      <div className="lab-fact">
        <strong>
          {document === 'entry'
            ? '1 : 1 · Entry-specific requirements'
            : '5 : 5 · Big Field and substitutions'}
        </strong>
        <p>
          {document === 'entry'
            ? {
                format:
                  'Choose the correct Entry sub-league in the source contents.',
                equipment:
                  'The large IR ball and Entry limits differ from the main leagues. Read the Entry dimensions and motor appendices.',
                event:
                  'Local organizers may adapt or replace the suggested Entry rules. Confirm the applicable version.',
              }[choice]
            : {
                format:
                  'Read the larger-team format, substitutions, and boundary procedures in this document.',
                equipment:
                  'The Big Field has its own dimensions. The main-field explorer is not a SuperTeam field model.',
                event:
                  'Coordinate robots and responsibilities with the other teams in your SuperTeam.',
              }[choice]}
        </p>
      </div>
      <p className="rule-source-note">
        Main-league animations and measurement checks are not automatically
        applied to this separate format.
      </p>
      <Button variant="outline" onClick={() => onDocument('soccer')}>
        Compare with main rules <ChevronRight />
      </Button>
    </section>
  );
}
