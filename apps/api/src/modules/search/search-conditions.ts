import { finiteMetric, refreshSeconds } from '../../shared/forecast-data';

export const conditionKey = (id: string) => `search:conditions:v2:${id.toLowerCase()}`;
export const emptyScores = () => ({ bathing: null, family: null, paddle: null, boat: null });
type Row = Record<string, any>;

export function freshSource(data: Row | undefined, now: number): boolean {
  const age = now - Date.parse(data?.fetchedAt);
  return !!data && data.kind === 'forecast' && ['available', 'partial'].includes(data.status) &&
    age >= 0 && age < (data.collectionIntervalSeconds === refreshSeconds ? refreshSeconds * 1000 : 900_000) &&
    Math.abs(now - Date.parse(data.validAt)) < 3600_000;
}

// The score endpoint publishes only provider-backed, dated values. Search never fetches forecasts.
export function conditionSnapshot(score: Row) {
  return { lat: score.beach.lat, lon: score.beach.lon, waterType: score.beach.waterType,
    calculatedAt: new Date().toISOString(), scores: score.scores, estimatedFlag: score.safety?.estimatedFlag,
    waterTemp: finiteMetric(score.current.marine.sea_surface_temperature),
    airTemp: finiteMetric(score.current.weather.temperature_2m), dataStatus: score.dataStatus };
}

export function searchConditions(beach: Row, snapshot: Row | null, now: number) {
  const valid = snapshot && snapshot.lat === beach.lat && snapshot.lon === beach.lon &&
    snapshot.waterType === beach.waterType && now - Date.parse(snapshot.calculatedAt) >= 0 &&
    now - Date.parse(snapshot.calculatedAt) < 900_000;
  const weather = valid && freshSource(snapshot.dataStatus?.weather, now);
  const marine = valid && freshSource(snapshot.dataStatus?.marine, now);
  return {
    scores: weather && marine ? snapshot.scores : emptyScores(),
    waterTemp: marine ? finiteMetric(snapshot.waterTemp) : null,
    airTemp: weather ? finiteMetric(snapshot.airTemp) : null,
    conditions: {
      calculatedAt: valid ? snapshot.calculatedAt : null,
      weather: weather ? snapshot.dataStatus.weather : null,
      marine: marine ? snapshot.dataStatus.marine : null,
    },
  };
}
