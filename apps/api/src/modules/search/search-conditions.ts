import { refreshSeconds } from '../../shared/forecast-data';
import { explainAll, measured, modelVersion } from '../score/comfort-model';

export const conditionKey = (id: string) => `search:conditions:${modelVersion}:${id.toLowerCase()}`;
type Row = Record<string, any>;

export function freshSource(data: Row | undefined, now: number): boolean {
  const age = now - Date.parse(data?.fetchedAt);
  return (
    !!data &&
    data.kind === 'forecast' &&
    ['available', 'partial'].includes(data.status) &&
    age >= 0 &&
    age < (data.collectionIntervalSeconds === refreshSeconds ? refreshSeconds * 1000 : 900_000) &&
    Math.abs(now - Date.parse(data.validAt)) < 3600_000
  );
}

// Store only dated model inputs, never an entire beach record or sanitary archive.
export function conditionSnapshot(score: Row) {
  const { weather, marine, waterQuality } = score.current;
  return {
    lat: score.beach.lat,
    lon: score.beach.lon,
    waterType: score.beach.waterType,
    calculatedAt: new Date(Date.now()).toISOString(),
    weather,
    marine,
    dataStatus: score.dataStatus,
    quality: waterQuality.status,
  };
}

export function estimatedFlag(bathing:number|null,wave:number|null,current:number|null,closed:boolean) {
  return closed || bathing === null || wave === null || current === null ? 'unknown'
    : bathing >= 78 && wave < 0.8 && current < 0.18 ? 'green' : bathing >= 55 && wave < 1.3 && current < 0.32 ? 'yellow' : 'red';
}

export function searchConditions(beach: Row, snapshot: Row | null, now: number, closed = false,
  community: Parameters<typeof explainAll>[4] = []) {
  const valid =
    snapshot &&
    snapshot.lat === beach.lat &&
    snapshot.lon === beach.lon &&
    snapshot.waterType === beach.waterType &&
    now - Date.parse(snapshot.calculatedAt) >= 0 &&
    now - Date.parse(snapshot.calculatedAt) < 900_000 &&
    !(snapshot.quality === 'closed' && !closed);
  const weather = valid && freshSource(snapshot.dataStatus?.weather, now);
  const marine = beach.waterType === 'sea' && valid && freshSource(snapshot.dataStatus?.marine, now);
  const read = (group: 'weather' | 'marine', key: string) =>
    (group === 'weather' ? weather : marine) && snapshot
      ? measured(key, snapshot[group]?.[key], snapshot.dataStatus[group].units?.[key])
      : null;
  const values = {
    wind_speed_10m: read('weather', 'wind_speed_10m'),
    wind_gusts_10m: read('weather', 'wind_gusts_10m'),
    uv_index: read('weather', 'uv_index'),
    wave_height: read('marine', 'wave_height'),
    ocean_current_velocity: read('marine', 'ocean_current_velocity'),
    sea_surface_temperature: read('marine', 'sea_surface_temperature'),
  };
  const explanations = explainAll(
    beach.waterType,
    values,
    !!valid && snapshot.quality === 'poor',
    closed,
    community,
  );
  const { bathing, family, paddle, boat } = explanations;
  return {
    explanations,
    estimatedFlag: estimatedFlag(bathing.score,values.wave_height,values.ocean_current_velocity,closed),
    scores: { bathing: bathing.score, family: family.score, paddle: paddle.score, boat: boat.score },
    waterTemp: values.sea_surface_temperature,
    airTemp: read('weather', 'temperature_2m'),
    conditions: {
      calculatedAt: valid ? snapshot.calculatedAt : null,
      weather: weather ? snapshot!.dataStatus.weather : null,
      marine: marine ? snapshot!.dataStatus.marine : null,
    },
  };
}
