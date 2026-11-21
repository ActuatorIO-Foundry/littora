// Transport double only. PostGIS, temporal validity and consensus are tested in the API suite.
export function searchResult(input: any, rows: any[], commune: any = null) {
  const items = rows.filter(b => (!input.q || commune || `${b.name} ${b.city} ${b.region}`.toLocaleLowerCase('fr').includes(input.q.toLocaleLowerCase('fr'))) &&
    (!input.waterType || b.waterType === input.waterType) && (!input.parking || b.has_parking === true) &&
    (!input.dogAccess || b.dogAccess?.status === 'allowed' || input.dogAccess === 'welcome' && b.dogAccess?.status === 'conditional') &&
    (!input.toilets || b.has_toilets === true) && (!input.rescueStation || b.facilities?.rescueStation?.value === true) &&
    (!input.flag || b.flag === input.flag) &&
    (input.minWaterTemp === undefined || b.waterTemp != null && b.waterTemp >= input.minWaterTemp) &&
    (input.maxWaterTemp === undefined || b.waterTemp != null && b.waterTemp <= input.maxWaterTemp));
  items.sort((a,b)=>(input.sort === 'distance' ? (a.distanceKm ?? Infinity)-(b.distanceKm ?? Infinity) : input.sort === 'score'
    ? (b.scores?.[input.usage] ?? b.selectedScore ?? -1)-(a.scores?.[input.usage] ?? a.selectedScore ?? -1)
    : a.name.localeCompare(b.name,'fr')) || a.id.localeCompare(b.id));
  const start=Number(input.cursor ?? 0),limit=input.limit ?? 200;
  const nextCursor=start+limit<items.length?String(start+limit):null;
  return {items:items.slice(start,start+limit),total:items.length,commune,
    asOf:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString(),
    pageInfo:{nextCursor,hasNextPage:nextCursor!==null,limit},unknownPolicy:'exclude-when-filtered',
    coverage:{candidates:rows.length,waterTemperature:rows.filter(b=>b.waterTemp!=null).length,
      airTemperature:0,scores:0,flags:0}};
}
