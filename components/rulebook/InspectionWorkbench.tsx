'use client';

import { useState } from 'react';
import { CheckCircle2, CircleAlert, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  DEFAULT_MEASUREMENTS,
  INSPECTION_CHECKS,
  INSPECTION_LIMITS,
  inspectionResults,
  type InspectionLeague,
  type Measurements,
} from '@/lib/rulebook/inspection';
import { cn } from '@/lib/utils';

export function LabRange({
  label,
  value,
  min = 0,
  max,
  step = 1,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="lab-range">
      <div>
        <span>{label}</span>
        <output>
          {value}
          {unit && ` ${unit}`}
        </output>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
        aria-label={label}
      />
    </div>
  );
}

export function InspectionWorkbench({
  onRule,
}: {
  onRule: (anchor: string) => void;
}) {
  const [league, setLeague] = useState<InspectionLeague>('vision');
  const [values, setValues] = useState<Measurements>({
    ...DEFAULT_MEASUREMENTS,
  });
  const [checked, setChecked] = useState<string[]>([]);
  const [station, setStation] = useState<
    'size' | 'capture' | 'handle' | 'power'
  >('size');
  const results = inspectionResults(league, values);
  const limits = INSPECTION_LIMITS[league];
  const checks = INSPECTION_CHECKS.filter(
    (check) => !check.infraredOnly || league === 'infrared',
  );
  const stationIds =
    station === 'size'
      ? ['diameter', 'height', 'mass']
      : station === 'capture'
        ? ['capture']
        : station === 'handle'
          ? ['handle', 'marker']
          : ['voltage', 'radio'];
  const activeResults = results.filter((result) =>
    stationIds.includes(result.id),
  );
  const set = (key: keyof Measurements, value: number) =>
    setValues((current) => ({ ...current, [key]: value }));
  const failed = results.filter((result) => !result.pass);
  const dimensionColor = failed.some(
    (result) => result.id === 'diameter' || result.id === 'height',
  )
    ? '#fb7185'
    : '#67e8f9';

  return (
    <section className="rule-lab">
      <div className="lab-heading">
        <div>
          <h2>Inspection workbench</h2>
          <p>Change a measurement and inspect the result.</p>
        </div>
        <Button
          variant="ghost"
          aria-label="Reset inspection measurements"
          onClick={() => {
            setValues({ ...DEFAULT_MEASUREMENTS });
            setChecked([]);
          }}
        >
          <RotateCcw />
        </Button>
      </div>
      <div className="lab-segmented" aria-label="Inspection league">
        {(['vision', 'infrared'] as const).map((item) => (
          <Button
            key={item}
            aria-pressed={league === item}
            variant={league === item ? 'secondary' : 'outline'}
            onClick={() => setLeague(item)}
          >
            {item === 'vision' ? 'Soccer Vision' : 'Soccer Infrared'}
          </Button>
        ))}
      </div>
      <div className="lab-tabs" aria-label="Inspection station">
        {(['size', 'capture', 'handle', 'power'] as const).map((item) => (
          <Button
            key={item}
            size="sm"
            variant={station === item ? 'secondary' : 'ghost'}
            onClick={() => setStation(item)}
            aria-pressed={station === item}
          >
            {
              {
                size: 'Size & mass',
                capture: 'Ball capture',
                handle: 'Handle & marker',
                power: 'Power & radio',
              }[item]
            }
          </Button>
        ))}
      </div>
      <svg
        className="inspection-diagram"
        viewBox="0 0 480 285"
        aria-label={`Inspection diagram: ${values.diameter} millimetre diameter, ${values.height} millimetre body height. ${station} station selected.`}
      >
        <defs>
          <pattern
            id="inspection-grid"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="#254253"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="480" height="285" fill="#0a1721" />
        <rect width="480" height="285" fill="url(#inspection-grid)" />
        {station === 'capture' ? (
          <>
            <path
              d="M90 50 H205 V95 H125 V195 H205 V235 H90 Z"
              fill="#224859"
              stroke="#8ba8bc"
            />
            <line
              x1="205"
              y1="40"
              x2="205"
              y2="245"
              stroke="#f8d36c"
              strokeWidth="3"
            />
            <circle
              cx={205 + 42 - values.capture * 2}
              cy="145"
              r="42"
              fill="#ee9547"
              stroke="#fed7aa"
              strokeWidth="2"
            />
            <line
              x1={205 - 30}
              y1="100"
              x2={205 - 30}
              y2="210"
              stroke="#fb7185"
              strokeDasharray="5 5"
            />
            <text x="28" y="25" fill="#d5e8f4" fontSize="14">
              Top view · straightedge at the front
            </text>
            <text
              x="25"
              y="268"
              fill={values.capture <= 15 ? '#67e8f9' : '#fb7185'}
              fontSize="15"
            >
              Capture: {values.capture} mm / 15 mm maximum
            </text>
            <text x="285" y="268" fill="#f8d36c" fontSize="13">
              Dashed = depth limit
            </text>
          </>
        ) : station === 'power' ? (
          <>
            {results
              .filter((result) => ['voltage', 'radio'].includes(result.id))
              .map((result, index) => (
                <g
                  key={result.id}
                  transform={`translate(40 ${70 + index * 110})`}
                >
                  <text fill="#e6edf5" fontSize="15">
                    {result.label}
                  </text>
                  <rect
                    x="0"
                    y="18"
                    width="400"
                    height="24"
                    rx="4"
                    fill="#1e3547"
                  />
                  <rect
                    x="0"
                    y="18"
                    width={Math.min(
                      400,
                      (result.value / (result.id === 'voltage' ? 60 : 150)) *
                        400,
                    )}
                    height="24"
                    rx="4"
                    fill={result.pass ? '#38bdf8' : '#fb7185'}
                  />
                  <line
                    x1={
                      ((result.limit ?? 0) /
                        (result.id === 'voltage' ? 60 : 150)) *
                      400
                    }
                    x2={
                      ((result.limit ?? 0) /
                        (result.id === 'voltage' ? 60 : 150)) *
                      400
                    }
                    y1="10"
                    y2="50"
                    stroke="#f8d36c"
                    strokeWidth="3"
                  />
                  <text y="68" fill="#a5bacb" fontSize="14">
                    {result.value} {result.unit} · limit {result.limit}{' '}
                    {result.unit}
                  </text>
                </g>
              ))}
          </>
        ) : (
          <>
            <line x1="28" y1="241" x2="450" y2="241" stroke="#8ba8bc" />
            <rect
              x={130 - limits.diameter * 0.3}
              y={240 - limits.height * 0.6}
              width={limits.diameter * 0.6}
              height={limits.height * 0.6}
              fill="none"
              stroke="#f8d36c"
              strokeDasharray="5 5"
            />
            <rect
              x={130 - values.diameter * 0.3}
              y={240 - values.height * 0.6}
              width={values.diameter * 0.6}
              height={values.height * 0.6}
              rx="5"
              fill="#24495d"
              stroke={dimensionColor}
              strokeWidth="2"
            />
            <path
              d={`M100 ${240 - values.height * 0.6} V${240 - (values.height + values.handle) * 0.6} H160 V${240 - values.height * 0.6}`}
              fill="none"
              stroke={values.handle >= 50 ? '#c5d9e7' : '#fb7185'}
              strokeWidth="6"
            />
            <line
              x1="230"
              x2="230"
              y1={240 - values.height * 0.6}
              y2={240 - (values.height + values.handle) * 0.6}
              stroke="#67e8f9"
              strokeWidth="2"
            />
            <circle
              cx="355"
              cy="160"
              r={limits.diameter * 0.3}
              fill="none"
              stroke="#f8d36c"
              strokeDasharray="5 5"
            />
            <circle
              cx="355"
              cy="160"
              r={values.diameter * 0.3}
              fill="#24495d"
              stroke={dimensionColor}
              strokeWidth="2"
            />
            <circle
              cx="355"
              cy="160"
              r={values.marker * 0.3}
              fill="#fff"
              stroke={values.marker >= 40 ? '#fff' : '#fb7185'}
              strokeWidth="3"
            />
            <text
              x="355"
              y="166"
              textAnchor="middle"
              fill="#102231"
              fontSize="16"
            >
              1
            </text>
            <text x="30" y="25" fill="#d5e8f4" fontSize="14">
              Side elevation
            </text>
            <text x="305" y="25" fill="#d5e8f4" fontSize="14">
              Top view
            </text>
            <text x="30" y="268" fill="#a5bacb" fontSize="13">
              Body {values.height} mm · handle gap {values.handle} mm
            </text>
            <text x="306" y="268" fill="#a5bacb" fontSize="13">
              Marker Ø{values.marker} mm
            </text>
          </>
        )}
      </svg>
      <div className="inspection-ranges">
        {station === 'size' && (
          <>
            <LabRange
              label="Robot diameter"
              value={values.diameter}
              min={100}
              max={250}
              unit="mm"
              onChange={(v) => set('diameter', v)}
            />
            <LabRange
              label="Body height"
              value={values.height}
              min={50}
              max={250}
              unit="mm"
              onChange={(v) => set('height', v)}
            />
            <LabRange
              label="Total robot mass"
              value={values.mass}
              min={500}
              max={2000}
              step={10}
              unit="g"
              onChange={(v) => set('mass', v)}
            />
          </>
        )}
        {station === 'capture' && (
          <LabRange
            label="Ball capture depth"
            value={values.capture}
            max={30}
            unit="mm"
            onChange={(v) => set('capture', v)}
          />
        )}
        {station === 'handle' && (
          <>
            <LabRange
              label="Handle clearance"
              value={values.handle}
              min={10}
              max={90}
              unit="mm"
              onChange={(v) => set('handle', v)}
            />
            <LabRange
              label="Marker diameter"
              value={values.marker}
              min={20}
              max={70}
              unit="mm"
              onChange={(v) => set('marker', v)}
            />
          </>
        )}
        {station === 'power' && (
          <>
            <NativeSelect
              aria-label="Electrical supply type"
              value={values.supply}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  supply: event.target.value as 'dc' | 'ac',
                }))
              }
            >
              <NativeSelectOption value="dc">DC</NativeSelectOption>
              <NativeSelectOption value="ac">AC RMS</NativeSelectOption>
            </NativeSelect>
            <LabRange
              label="Supply voltage"
              value={values.voltage}
              max={60}
              unit="V"
              onChange={(v) => set('voltage', v)}
            />
            <LabRange
              label="Radio power (2.4 GHz EIRP)"
              value={values.radio}
              max={150}
              unit="mW"
              onChange={(v) => set('radio', v)}
            />
          </>
        )}
      </div>
      <div className="inspection-results">
        {activeResults.map((result) => (
          <button
            key={result.id}
            onClick={() => onRule(result.anchor)}
            className={cn(
              'inspection-result',
              !result.pass && 'inspection-fail',
            )}
          >
            {result.pass ? <CheckCircle2 /> : <CircleAlert />}
            <span>
              {result.label}
              <small>
                {result.limit === null
                  ? 'No mass limit in Vision'
                  : `${result.minimum ? 'At least' : 'At most'} ${result.limit} ${result.unit}`}
              </small>
            </span>
            <strong>{result.pass ? 'Within limit' : 'Adjust'}</strong>
          </button>
        ))}
      </div>
      <output className="lab-status">
        {failed.length
          ? `${failed.length} measurement${failed.length === 1 ? '' : 's'} outside limits`
          : 'Entered measurements are within these limits'}
      </output>
      <p className="rule-small">
        Measurement aid for the main leagues. Certification requires an official
        inspection; component exceptions and event requirements remain in the
        source text.
      </p>
      <h3 className="lab-subheading">Hands-on inspection checklist</h3>
      <div className="lab-checklist">
        {checks.map((item) => (
          <div key={item.id}>
            <label htmlFor={`inspection-${item.id}`}>
              <Checkbox
                id={`inspection-${item.id}`}
                checked={checked.includes(item.id)}
                onCheckedChange={(next) =>
                  setChecked((current) =>
                    next
                      ? [...new Set([...current, item.id])]
                      : current.filter((id) => id !== item.id),
                  )
                }
              />
              <span>{item.label}</span>
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRule(item.anchor)}
              aria-label={`Read rule: ${item.label}`}
            >
              Rule ↗
            </Button>
          </div>
        ))}
      </div>
      <p className="rule-small">
        {checks.filter((item) => checked.includes(item.id)).length} /{' '}
        {checks.length} checked in this session. A checklist is not a
        certificate.
      </p>
    </section>
  );
}
