export type InspectionLeague = 'vision' | 'infrared';
export type Measurements = {
  diameter: number;
  height: number;
  mass: number;
  capture: number;
  handle: number;
  marker: number;
  voltage: number;
  radio: number;
  supply: 'dc' | 'ac';
};
export const DEFAULT_MEASUREMENTS: Measurements = {
  diameter: 176,
  height: 170,
  mass: 1450,
  capture: 12,
  handle: 55,
  marker: 45,
  voltage: 12,
  radio: 80,
  supply: 'dc',
};
export const INSPECTION_LIMITS = {
  vision: { diameter: 180, height: 180, mass: null },
  infrared: { diameter: 220, height: 220, mass: 1500 },
} as const;
export function inspectionResults(
  league: InspectionLeague,
  values: Measurements,
) {
  const limit = INSPECTION_LIMITS[league];
  return [
    {
      id: 'diameter',
      label: 'Cylinder diameter',
      value: values.diameter,
      unit: 'mm',
      limit: limit.diameter,
      minimum: false,
      anchor: 'dimensions',
    },
    {
      id: 'height',
      label: 'Body height',
      value: values.height,
      unit: 'mm',
      limit: limit.height,
      minimum: false,
      anchor: 'dimensions',
    },
    {
      id: 'mass',
      label: 'Mass',
      value: values.mass,
      unit: 'g',
      limit: limit.mass,
      minimum: false,
      anchor: 'dimensions',
    },
    {
      id: 'capture',
      label: 'Capture depth',
      value: values.capture,
      unit: 'mm',
      limit: 15,
      minimum: false,
      anchor: 'dimensions',
    },
    {
      id: 'handle',
      label: 'Handle clearance',
      value: values.handle,
      unit: 'mm',
      limit: 50,
      minimum: true,
      anchor: 'handle',
    },
    {
      id: 'marker',
      label: 'White marker diameter',
      value: values.marker,
      unit: 'mm',
      limit: 40,
      minimum: true,
      anchor: 'top-markers',
    },
    {
      id: 'voltage',
      label: values.supply === 'dc' ? 'DC voltage' : 'AC RMS voltage',
      value: values.voltage,
      unit: 'V',
      limit: values.supply === 'dc' ? 48 : 25,
      minimum: false,
      anchor: '_safety_and_power_requirements',
    },
    {
      id: 'radio',
      label: '2.4 GHz radio EIRP',
      value: values.radio,
      unit: 'mW',
      limit: 100,
      minimum: false,
      anchor: '_robot_communication',
    },
  ].map((result) => ({
    ...result,
    pass:
      Number.isFinite(result.value) &&
      result.value >= 0 &&
      (result.limit === null ||
        (result.minimum
          ? result.value >= result.limit
          : result.value <= result.limit)),
  }));
}

export const INSPECTION_CHECKS = [
  {
    id: 'extended',
    label: 'All mechanisms extended for measurement',
    anchor: 'dimensions',
  },
  {
    id: 'access',
    label: 'Opponent can reach and take the ball',
    anchor: 'dimensions',
  },
  {
    id: 'handle',
    label: 'Handle accessible, secure; handle mass included',
    anchor: 'handle',
  },
  {
    id: 'marker',
    label: 'Horizontal white plastic marker, visible and writable',
    anchor: 'top-markers',
  },
  {
    id: 'colors',
    label: 'Visible orange / blue / yellow construction parts covered',
    anchor: 'robots-interference',
  },
  {
    id: 'lights',
    label: 'Interfering lights and magnetic emissions addressed',
    anchor: 'robots-interference',
  },
  {
    id: 'ir',
    label: 'Infrared league: IR emitters removed or covered',
    anchor: 'regulations-inference-in-infrared',
    infraredOnly: true,
  },
  {
    id: 'battery',
    label: 'Battery secured; safe wiring and voltage test points',
    anchor: '_safety_and_power_requirements',
  },
  {
    id: 'charging',
    label: 'Lithium safety bag and supervised charging',
    anchor: '_safety_and_power_requirements',
  },
  {
    id: 'stop',
    label: 'Emergency stop and mechanical hazards checked',
    anchor: '_safety_and_power_requirements',
  },
  {
    id: 'autonomy',
    label: 'Autonomous movement and ball response demonstrated',
    anchor: 'robots-control',
  },
  {
    id: 'module',
    label: 'Event communication module fitted where required',
    anchor: 'international-competition-specifics',
  },
  {
    id: 'kicker',
    label: 'Kicker tested with the event ball and field',
    anchor: 'kicker-power-measuring',
  },
  {
    id: 'daily',
    label: 'Today’s inspection completed with an official',
    anchor: 'regulations-inspections',
  },
];
