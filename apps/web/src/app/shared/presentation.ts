import { DataStatus } from '../models/beach.model';

export function flagLabel(flag?: string | null): string {
  switch (flag) {
    case 'green': return 'Vert';
    case 'yellow': return 'Jaune';
    case 'red': return 'Rouge';
    default: return '';
  }
}

export function freshnessDeadline(data: DataStatus): number {
  return Date.parse(data.fetchedAt ?? '') + (data.collectionIntervalSeconds ?? NaN) * 1000;
}
export function forecastIsStale(data: DataStatus, now = Date.now()): boolean {
  return data.status === 'stale' || (data.status !== 'unknown' && now >= freshnessDeadline(data));
}

export function dataStatusLabel(data?: DataStatus): string {
  if (!data) return '';
  const date = (v: string) => new Date(v).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return [({ unknown: 'Données indisponibles', stale: 'Prévisions périmées', partial: 'Prévisions partielles', available: 'Prévisions' })[forecastIsStale(data) ? 'stale' : data.status],
    data.fetchedAt && `collecte : ${date(data.fetchedAt)}`,
    data.validAt && `échéance : ${date(data.validAt)}`,
    data.nextCheckAt && `prochaine vérification au plus tôt : ${date(data.nextCheckAt)}`,
    data.collectionIntervalSeconds && `collecte toutes les ${data.collectionIntervalSeconds / 3600} h ; mise à jour du modèle variable`,
  ].filter(Boolean).join(' · ');
}

export function providerLabel(provider?: string): string {
  const names: Record<string, string> = {
    "open-meteo": "Open-Meteo",
    "open-meteo-marine": "Open-Meteo Marine",
    "open-meteo-mapped": "Open-Meteo (modèle Météo-France)",
    "open-meteo-fallback": "Open-Meteo",
    "local-weather-fallback": "Estimation locale, non observée",
    "local-marine-fallback": "Estimation locale, non observée",
    "local-tide-estimator": "Estimation locale, non observée",
    "shom-spm": "SHOM, disponibilité à vérifier",
    "shom": "SHOM, source non connectée",
    "baignades-sante/data-gouv-ready": "Source sanitaire non connectée",
    "local-cache": "Données locales à vérifier",
    "littora-reports": "Communauté Littora",
  };
  return provider ? (names[provider] ?? provider) : "Non renseigné";
}
export function metricClass(kind: string, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "metric-neutral";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "metric-neutral";
  if (kind === "air" || kind === "water")
    return n < 20
      ? "metric-blue"
      : n < 25
        ? "metric-green"
        : n < 30
          ? "metric-orange"
          : "metric-red";
  if (kind === "uv")
    return n < 3 ? "metric-green" : n < 6 ? "metric-orange" : "metric-red";
  if (kind === "wind")
    return n < 12 ? "metric-green" : n < 25 ? "metric-orange" : "metric-red";
  if (kind === "wave")
    return n < 0.5 ? "metric-green" : n < 1.2 ? "metric-orange" : "metric-red";
  return "metric-neutral";
}
