// This identifies a publisher's bulletin, never the colour currently flown.
export function flagBulletinFor(site: unknown, water: unknown, lat: unknown, lon: unknown) {
  if (site !== 'node/2417680230' || water !== 'sea' ||
      typeof lat !== 'number' || typeof lon !== 'number' ||
      !(Math.abs(lat - 43.6417672) < 0.002 && Math.abs(lon + 1.4475108) < 0.002)) return undefined;
  return {
    provider: 'plages-landes' as const,
    publisher: 'Landes Attractivité',
    zone: 'Plage de la Piste · Capbreton',
    widgetId: 560,
    sourceUrl: 'https://www.plages-landes.info/plages/plage-de-la-piste/',
    linkVerifiedOn: '2026-11-23',
  };
}
