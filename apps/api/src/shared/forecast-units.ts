type MetricRule = { unit: string; min: number; max: number; convert?: Record<string, (n: number) => number> };
const celsius = { '\u00b0F': (n: number) => (n - 32) / 1.8 };
const speedToKmh = { 'm/s': (n: number) => n * 3.6, mph: (n: number) => n * 1.609344, kn: (n: number) => n * 1.852 };
const height: MetricRule = { unit: 'm', min: 0, max: 40, convert: { ft: n => n * 0.3048 } };
const direction: MetricRule = { unit: '\u00b0', min: 0, max: 360 };
const period: MetricRule = { unit: 's', min: 0, max: 60 };

export const forecastUnits: Record<string, MetricRule> = {
  temperature_2m: { unit: '\u00b0C', min: -100, max: 70, convert: celsius },
  apparent_temperature: { unit: '\u00b0C', min: -120, max: 90, convert: celsius },
  sea_surface_temperature: { unit: '\u00b0C', min: -5, max: 50, convert: celsius },
  relative_humidity_2m: { unit: '%', min: 0, max: 100 },
  cloud_cover: { unit: '%', min: 0, max: 100 },
  precipitation: { unit: 'mm', min: 0, max: 1000, convert: { inch: n => n * 25.4 } },
  uv_index: { unit: '', min: 0, max: 40 },
  wind_speed_10m: { unit: 'km/h', min: 0, max: 500, convert: speedToKmh },
  wind_gusts_10m: { unit: 'km/h', min: 0, max: 500, convert: speedToKmh },
  wind_direction_10m: direction,
  wave_height: height, swell_wave_height: height, wind_wave_height: height,
  wave_direction: direction, swell_wave_direction: direction,
  wave_period: period, swell_wave_period: period,
  ocean_current_velocity: { unit: 'm/s', min: 0, max: 15, convert: {
    'km/h': n => n / 3.6, mph: n => n * 0.44704, kn: n => n * 1852 / 3600,
  } },
  ocean_current_direction: direction,
};

export function normalizeMetric(key: string, value: unknown, sourceUnit: unknown): number | null {
  const rule = forecastUnits[key];
  if (!rule || typeof value !== 'number' || !Number.isFinite(value) || typeof sourceUnit !== 'string') return null;
  const convert = rule.convert && Object.prototype.hasOwnProperty.call(rule.convert, sourceUnit) ? rule.convert[sourceUnit] : undefined;
  const result = sourceUnit === rule.unit ? value : convert ? convert(value) : NaN;
  // Broad physical plausibility limits, not bathing or navigation thresholds.
  return Number.isFinite(result) && result >= rule.min && result <= rule.max ? result : null;
}
