import { forecastUnits, normalizeMetric } from '../../shared/forecast-units';

export const modelVersion = 'confort-3';
const metrics = {
  wind_speed_10m: 'Vent',
  wind_gusts_10m: 'Rafales',
  wave_height: 'Vagues',
  ocean_current_velocity: 'Courant marin',
  uv_index: 'Indice UV',
  sea_surface_temperature: 'Température de l’eau',
} as const;
type Metric = keyof typeof metrics;
type Usage = 'bathing' | 'family' | 'paddle' | 'boat' | 'catamaran' | 'windsurf';
type Factor = { label: string; points: number };
type Inputs = Partial<Record<Metric, number | 'stale' | 'invalid' | null>>;
type Reports = Array<{ type: string; count: number; confidence: number }>;
export type Explanation = {
  version: string;
  status: 'calculated' | 'partial' | 'insufficient' | 'not-applicable' | 'closed';
  score: number | null;
  partialScore: number | null;
  required: number;
  available: number;
  missing: string[];
  stale: string[];
  invalid: string[];
  factors: Factor[];
};

// Points lost per canonical unit outside the editorial comfort band. Not safety limits.
const weights: Record<Usage, Partial<Record<Metric, number>>> = {
  bathing: {
    wind_speed_10m: 1,
    wind_gusts_10m: 0.5,
    wave_height: 20,
    ocean_current_velocity: 40,
    uv_index: 2,
    sea_surface_temperature: 3,
  },
  family: {
    wind_speed_10m: 1,
    wind_gusts_10m: 0.6,
    wave_height: 28,
    ocean_current_velocity: 50,
    uv_index: 3,
    sea_surface_temperature: 4,
  },
  paddle: { wind_speed_10m: 2, wind_gusts_10m: 1, wave_height: 28, ocean_current_velocity: 55 },
  catamaran: { wind_speed_10m: 4, wind_gusts_10m: 2, wave_height: 22, ocean_current_velocity: 35 },
  windsurf: { wind_speed_10m: 4, wind_gusts_10m: 2, wave_height: 24, ocean_current_velocity: 40 },
  boat: { wind_speed_10m: 1, wind_gusts_10m: 0.6, wave_height: 22, ocean_current_velocity: 35 },
};
const penalties: Record<string, [string, Partial<Record<Usage, number>>]> = {
  pollution: ['Pollution signalée', { bathing: 22, family: 22 }],
  jellyfish: ['Méduses signalées', { bathing: 12, family: 12 }],
  current: ['Courant signalé', { bathing: 10, family: 10, paddle: 14, boat: 7, catamaran: 7, windsurf: 14 }],
  crowd: ['Affluence signalée', { family: 6 }],
};
export function measured(key: string, value: unknown, unit: unknown) {
  return unit === forecastUnits[key].unit ? normalizeMetric(key, value, unit) : null;
}
const sailingBands = { catamaran: [12,22], windsurf: [15,25] } as const;
function exposure(usage: Usage, key: Metric, n: number) {
  if (usage === 'catamaran' || usage === 'windsurf') {
    const [low, high] = sailingBands[usage];
    if (key === 'wind_speed_10m') return Math.max(0, low-n, n-high);
    if (key === 'wind_gusts_10m') return Math.max(0, n-high);
  }
  if (key === 'sea_surface_temperature') return Math.max(20 - n, 0, n - 25);
  if (key === 'uv_index') return Math.max(0, n - 2);
  return n;
}
export function explainUsage(
  usage: Usage,
  waterType: string,
  values: Inputs,
  poor: boolean,
  closed: boolean,
  reports: Reports,
): Explanation {
  const e: Explanation = {
    version: usage === 'catamaran' || usage === 'windsurf' ? 'voile-loisir-1' : modelVersion,
    status: 'not-applicable',
    score: null,
    partialScore: null,
    required: 0,
    available: 0,
    missing: [],
    stale: [],
    invalid: [],
    factors: [],
  };
  const bathing = usage === 'bathing' || usage === 'family';
  if (closed && bathing) return { ...e, status: 'closed', score: 0 };
  if (waterType !== 'sea') return e;
  for (const [key, weight] of Object.entries(weights[usage]) as [Metric, number][]) {
    const value = values[key];
    e.required++;
    if (value == null) {
      e.missing.push(metrics[key]);
      continue;
    }
    if (value === 'stale' || value === 'invalid') {
      e[value].push(metrics[key]);
      continue;
    }
    e.available++;
    e.factors.push({ label: metrics[key], points: -Math.round(exposure(usage, key, value) * weight) || 0 });
  }
  if (poor && bathing) e.factors.push({ label: 'Prélèvement récent défavorable', points: -35 });
  for (const [type, [label, byUsage]] of Object.entries(penalties)) {
    const weight = byUsage[usage];
    if (!weight) continue;
    const support = reports
      .filter(
        (r) => r.type === type && Number.isFinite(Number(r.count)) && Number.isFinite(Number(r.confidence)),
      )
      .reduce((sum, r) => sum + Math.max(0, r.count) * Math.max(0, Math.min(1, r.confidence)), 0);
    const loss = Math.round(weight * Math.min(1, support));
    if (loss) e.factors.push({ label, points: -loss });
  }
  if (!e.available) return { ...e, status: 'insufficient' };
  const result = Math.max(0, 100 + e.factors.reduce((n, f) => n + f.points, 0));
  // Every factor is a deduction. With incomplete inputs the result is an upper bound, not a rank.
  return e.available === e.required ? { ...e, status: 'calculated', score: result }
    : { ...e, status: 'partial', partialScore: result };
}
export function explainAll(
  waterType: string,
  values: Inputs,
  poor: boolean,
  closed: boolean,
  reports: Reports,
) {
  const forUsage = (u: Usage) => explainUsage(u, waterType, values, poor, closed, reports);
  return {
    bathing: forUsage('bathing'),
    family: forUsage('family'),
    paddle: forUsage('paddle'),
    catamaran: forUsage('catamaran'),
    windsurf: forUsage('windsurf'),
    boat: forUsage('boat'),
  };
}
