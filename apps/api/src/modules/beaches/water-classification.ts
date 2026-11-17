export type WaterType = 'sea' | 'lake' | 'river' | 'unknown';
export const classificationSource = 'https://data.geopf.fr/wfs/ows';
export const classificationLayers = ['limite_terre_mer', 'surface_hydrographique'] as const;
export type Evidence = {
  referenceId: string; layer: string; nature: string; waterType: WaterType;
  distanceMeters: number; sourceUpdatedAt: string | null;
};

// Only structured IGN attributes are interpreted. Names, regions and salinity are not evidence.
export function referenceWaterType(layer: string, properties: Record<string, unknown>): WaterType {
  if (layer === 'limite_terre_mer') return properties.niveau === 'Plus hautes eaux' ? 'sea' : 'unknown';
  if (layer !== 'surface_hydrographique' || properties.etat_de_l_objet !== 'En service') return 'unknown';
  if (properties.nature === 'Lac') return 'lake';
  // Technical basins, canals, lagoons and other unspecified surfaces remain unknown.
  return properties.nature === 'Ecoulement naturel' ? 'river' : 'unknown';
}

export function decideWaterType(candidates: Evidence[]): { waterType: WaterType; reason: string; evidence: Evidence[] } {
  const nearby = candidates.filter(c => Number.isFinite(c.distanceMeters) && c.distanceMeters >= 0 && c.distanceMeters <= 200)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.referenceId.localeCompare(b.referenceId));
  if (!nearby.length) return { waterType: 'unknown', reason: 'no-nearby-reference', evidence: [] };
  const closest = nearby[0];
  // At estuaries or adjacent water bodies, small distance differences are not reliable evidence.
  const competing = nearby.filter(c => c.distanceMeters <= closest.distanceMeters + 30);
  const ambiguous = competing.some(c => c.waterType !== closest.waterType);
  return { waterType: ambiguous ? 'unknown' : closest.waterType,
    reason: ambiguous ? 'ambiguous-water-bodies' : closest.waterType === 'unknown' ? 'unsupported-water-body' : 'nearest-water-body',
    evidence: nearby.slice(0, 12) };
}

export async function classifyPosition(db: { query: Function }, beach: { lat: number; lon: number }, references: any[]) {
  const { rows } = await db.query(`with refs as (
    select r.*, ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(r.geometry),4326)) as shape
    from jsonb_to_recordset($1::jsonb) as r("referenceId" text,layer text,nature text,"waterType" text,"sourceUpdatedAt" text,geometry jsonb)
  ) select "referenceId",layer,nature,"waterType","sourceUpdatedAt",
    case when ST_IsValid(shape) then ST_Distance(shape::geography,ST_SetSRID(ST_MakePoint($3,$2),4326)::geography)
      else -1 end as "distanceMeters"
  from refs where not ST_IsValid(shape) or ST_DWithin(shape::geography,ST_SetSRID(ST_MakePoint($3,$2),4326)::geography,200)`,
  [JSON.stringify(references), beach.lat, beach.lon]);
  if (rows.some((row: Evidence) => row.distanceMeters < 0)) throw new Error('Invalid geographic geometry');
  return decideWaterType(rows);
}

export function normalizeReferences(layer: string, collection: any) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features) ||
      !Number.isInteger(collection.totalFeatures) || collection.totalFeatures !== collection.features.length) {
    throw new Error('Incomplete geographic reference');
  }
  return collection.features.flatMap((feature: any) => {
    const properties = feature.properties ?? {};
    if (layer === 'limite_terre_mer' && properties.niveau !== 'Plus hautes eaux') return [];
    if (typeof properties.cleabs !== 'string' || !feature.geometry ||
        !['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(feature.geometry.type)) {
      throw new Error('Invalid geographic reference');
    }
    return [{ referenceId: properties.cleabs, layer, nature: String(properties.nature ?? properties.niveau ?? ''),
      waterType: referenceWaterType(layer, properties), sourceUpdatedAt: Number.isFinite(Date.parse(properties.date_modification))
        ? new Date(properties.date_modification).toISOString() : null,
      geometry: feature.geometry }];
  });
}
