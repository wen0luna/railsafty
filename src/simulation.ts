import type { IconName } from './icons.ts';
import { message, t } from './i18n.ts';
import type { LocalizedMessage } from './i18n.ts';

export type SensorType = 'camera' | 'infrared' | 'radar' | 'rain' | 'displacement';
export type ScenarioId = 'normal' | 'person' | 'animal' | 'rain' | 'slope' | 'rockfall';
export type RiskLevel = 'normal' | 'warning' | 'critical';

interface SensorDefinition {
  name: string;
  shortName: string;
  prefix: string;
  icon: IconName;
  color: string;
  count: number;
  description: string;
}

function sensorDefinition(type: SensorType, data: Omit<SensorDefinition, 'name' | 'shortName' | 'description'>): SensorDefinition {
  return {
    ...data,
    get name() { return t(`sensor.${type}.name`); },
    get shortName() { return t(`sensor.${type}.short`); },
    get description() { return t(`sensor.${type}.description`); },
  };
}

export const SENSOR_TYPES: Record<SensorType, SensorDefinition> = {
  camera: sensorDefinition('camera', { prefix: 'HD', icon: 'camera', color: '#298e91', count: 8 }),
  infrared: sensorDefinition('infrared', { prefix: 'IR', icon: 'infrared', color: '#8a79b0', count: 4 }),
  radar: sensorDefinition('radar', { prefix: 'MW', icon: 'radar', color: '#298866', count: 4 }),
  rain: sensorDefinition('rain', { prefix: 'RG', icon: 'rain', color: '#5a8fb6', count: 4 }),
  displacement: sensorDefinition('displacement', { prefix: 'DS', icon: 'displacement', color: '#bc9859', count: 4 }),
};

interface ScenarioDefinition {
  name: string;
  icon: IconName;
  risk: RiskLevel;
  title: string;
  detail: string;
  location: string;
  position: [number, number];
  sensors: SensorType[];
}

function scenarioDefinition(id: ScenarioId, data: Omit<ScenarioDefinition, 'name' | 'title' | 'detail' | 'location'>): ScenarioDefinition {
  return {
    ...data,
    get name() { return t(`scenario.${id}.name`); },
    get title() { return t(`scenario.${id}.title`); },
    get detail() { return t(`scenario.${id}.detail`); },
    get location() { return t(`scenario.${id}.location`); },
  };
}

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  normal: scenarioDefinition('normal', { icon: 'shield', risk: 'normal', position: [0, 0], sensors: [] }),
  person: scenarioDefinition('person', { icon: 'person', risk: 'critical', position: [3, 5.5], sensors: ['camera', 'infrared', 'radar'] }),
  animal: scenarioDefinition('animal', { icon: 'animal', risk: 'warning', position: [-17, 7], sensors: ['camera', 'infrared', 'radar'] }),
  rain: scenarioDefinition('rain', { icon: 'rain', risk: 'warning', position: [-38, -16], sensors: ['rain', 'camera'] }),
  slope: scenarioDefinition('slope', { icon: 'mountain', risk: 'critical', position: [29, -23], sensors: ['displacement', 'rain', 'camera'] }),
  rockfall: scenarioDefinition('rockfall', { icon: 'rock', risk: 'critical', position: [35, -7], sensors: ['radar', 'camera', 'displacement'] }),
};

export const RESPONSE_PHASES = ['detected', 'verified', 'responding', 'resolved'] as const;
export type ResponsePhase = typeof RESPONSE_PHASES[number];
export type ResponseSource = 'operator' | 'auto-demo';
export const RESPONSE_LABELS: Record<ResponsePhase, string> = {
  get detected() { return t('response.phase.detected'); },
  get verified() { return t('response.phase.verified'); },
  get responding() { return t('response.phase.responding'); },
  get resolved() { return t('response.phase.resolved'); },
};
function responsePlan(scenario: Exclude<ScenarioId, 'normal'>): { action: string; instruction: string } {
  return {
    get action() { return t(`response.plan.${scenario}.action`); },
    get instruction() { return t(`response.plan.${scenario}.instruction`); },
  };
}
export const RESPONSE_PLANS: Record<Exclude<ScenarioId, 'normal'>, { action: string; instruction: string }> = {
  person: responsePlan('person'),
  animal: responsePlan('animal'),
  rain: responsePlan('rain'),
  slope: responsePlan('slope'),
  rockfall: responsePlan('rockfall'),
};

export interface Device {
  id: string;
  type: SensorType;
  name: string;
  x: number;
  z: number;
  mileage: string;
}

export function routeZ(x: number): number {
  return Math.sin(x / 58) * 10;
}

export function routeY(x: number): number {
  return 7.1 + Math.cos(x / 75) * 0.75;
}

const sensorPositions: Record<SensorType, number[]> = {
  camera: [-76, -55, -29, -4, 20, 42, 63, 81],
  infrared: [-59, -14, 33, 72],
  radar: [-66, -22, 24, 66],
  rain: [-41, 5, 48, 77],
  displacement: [-65, -18, 30, 60],
};

const sensorOffsets: Record<SensorType, number> = {
  camera: 10,
  infrared: -11,
  radar: 12,
  rain: -20,
  displacement: -27,
};

export const DEVICES: Device[] = (Object.keys(SENSOR_TYPES) as SensorType[]).flatMap((type) =>
  sensorPositions[type].map((x, index) => {
    const definition = SENSOR_TYPES[type];
    return {
      id: `${definition.prefix}-${String(index + 1).padStart(3, '0')}`,
      type,
      get name() { return t('sensor.deviceName', { name: definition.name, number: String(index + 1).padStart(2, '0') }); },
      x,
      z: routeZ(x) + sensorOffsets[type],
      mileage: `K${128 + Math.floor(((x + 90) / 180) * 4)}+${String(Math.floor((((x + 90) / 180) * 4000) % 1000)).padStart(3, '0')}`,
    };
  }),
);

export const LABEL_DEVICE_IDS = ['HD-003', 'IR-003', 'MW-004', 'RG-001', 'DS-003'];

export interface Telemetry {
  rainRate: number;
  dailyRain: number;
  displacement: number;
  temperature: number;
  wind: number;
  humidity: number;
  range: number;
  confidence: number;
}

const round = (value: number, precision = 1): number => Number(value.toFixed(precision));

export function getTelemetry(scenario: ScenarioId, seconds: number): Telemetry {
  const wave = Math.sin(seconds * 0.24);
  return {
    rainRate: scenario === 'rain' ? round(48.6 + wave * 1.8) : scenario === 'slope' ? round(12.4 + wave * 0.7) : 0,
    dailyRain: scenario === 'rain' ? round(64.2 + seconds * 0.001) : scenario === 'slope' ? 28.6 : 2.4,
    displacement: scenario === 'slope' ? round(4.8 + wave * 0.15, 2) : scenario === 'rockfall' ? round(2.6 + wave * 0.08, 2) : round(0.62 + wave * 0.04, 2),
    temperature: round((scenario === 'rain' ? 18.2 : 22.6) + Math.sin(seconds * 0.02) * 0.4),
    wind: round((scenario === 'rain' ? 7.2 : 2.3) + wave * 0.3),
    humidity: scenario === 'rain' ? 92 : 64,
    range: round(29.4 + Math.sin(seconds * 0.5) * 1.2),
    confidence: scenario === 'animal' ? 97.2 : 98.6,
  };
}

export interface AlertRecord {
  id: string;
  scenario: Exclude<ScenarioId, 'normal'>;
  createdAt: number;
  resolvedAt: number | null;
  resolution: LocalizedMessage | null;
  phase: ResponsePhase;
  outcome: 'handled' | 'cancelled' | null;
  timeline: { phase: ResponsePhase; at: number; note: LocalizedMessage }[];
}

export interface SimulationState {
  scenario: ScenarioId;
  alerts: AlertRecord[];
  nextId: number;
}

export function createSimulation(now: number): SimulationState {
  const history = (id: string, scenario: AlertRecord['scenario'], minutes: number, resolution: LocalizedMessage): AlertRecord => {
    const createdAt = now - minutes * 60000;
    const resolvedAt = createdAt + 3 * 60000;
    return {
      id, scenario, createdAt, resolvedAt, resolution, phase: 'resolved', outcome: 'handled',
      timeline: [
        { phase: 'detected', at: createdAt, note: message('record.historyDetected') },
        { phase: 'verified', at: createdAt + 60000, note: message('record.historyVerified') },
        { phase: 'responding', at: createdAt + 90000, note: message('record.historyDispatched', { action: message(`response.plan.${scenario}.action`) }) },
        { phase: 'resolved', at: resolvedAt, note: resolution },
      ],
    };
  };
  return {
    scenario: 'normal',
    alerts: [
      history('RG-20260002', 'rain', 38, message('record.historyRainResolved')),
      history('RG-20260001', 'animal', 75, message('record.historyAnimalResolved')),
    ],
    nextId: 3,
  };
}

function archivePending(alerts: AlertRecord[], now: number, resolution: LocalizedMessage, outcome: 'handled' | 'cancelled'): AlertRecord[] {
  return alerts.map((alert): AlertRecord => alert.resolvedAt === null ? {
    ...alert, resolvedAt: now, resolution, outcome, phase: 'resolved',
    timeline: [...alert.timeline, { phase: 'resolved', at: now, note: resolution }],
  } : alert);
}

export function activateScenario(state: SimulationState, scenario: ScenarioId, now: number, source: ResponseSource = 'operator'): SimulationState {
  if (state.scenario === scenario) return state;
  const alerts = archivePending(state.alerts, now, message('record.cancelled'), 'cancelled');
  if (scenario === 'normal') return { ...state, scenario, alerts };
  return {
    scenario,
    alerts: [{
      id: `RG-2026${String(state.nextId).padStart(4, '0')}`, scenario, createdAt: now,
      resolvedAt: null, resolution: null, phase: 'detected', outcome: null,
      timeline: [{
        phase: 'detected', at: now,
        note: message(source === 'auto-demo' ? 'record.autoDemoDetected' : 'record.detected', { name: message(`scenario.${scenario}.name`) }),
      }],
    }, ...alerts],
    nextId: state.nextId + 1,
  };
}

export function advanceResponse(state: SimulationState, now: number, source: ResponseSource = 'operator'): SimulationState {
  const active = state.alerts.find((alert) => alert.resolvedAt === null);
  if (!active || (active.phase !== 'detected' && active.phase !== 'verified')) return state;
  const phase: ResponsePhase = active.phase === 'detected' ? 'verified' : 'responding';
  const note = phase === 'verified'
    ? message(source === 'auto-demo' ? 'record.autoDemoVerified' : 'record.verified')
    : message(source === 'auto-demo' ? 'record.autoDemoDispatched' : 'record.dispatched', { action: message(`response.plan.${active.scenario}.action`) });
  return {
    ...state,
    alerts: state.alerts.map((alert) => alert.id === active.id ? {
      ...alert, phase, timeline: [...alert.timeline, { phase, at: now, note }],
    } : alert),
  };
}

export function resolveCurrentAlert(state: SimulationState, now: number, source: ResponseSource = 'operator'): SimulationState {
  const active = state.alerts.find((alert) => alert.resolvedAt === null);
  if (!active || active.phase !== 'responding') return state;
  const note = message(source === 'auto-demo' ? 'record.autoDemoHandled' : 'record.handled');
  return { ...state, scenario: 'normal', alerts: archivePending(state.alerts, now, note, 'handled') };
}

export function sensorReading(type: SensorType, telemetry: Telemetry, scenario: ScenarioId): string {
  switch (type) {
    case 'camera': return t(scenario === 'person' || scenario === 'animal' || scenario === 'rockfall' ? 'reading.target' : 'reading.hd');
    case 'infrared': return t(scenario === 'person' || scenario === 'animal' ? 'reading.heatTarget' : 'reading.thermal');
    case 'radar': return scenario === 'person' || scenario === 'animal' || scenario === 'rockfall' ? t('reading.range', { value: telemetry.range }) : t('reading.scanning');
    case 'rain': return `${telemetry.rainRate.toFixed(1)} mm/h`;
    case 'displacement': return `Δ ${telemetry.displacement.toFixed(2)} mm`;
  }
}
