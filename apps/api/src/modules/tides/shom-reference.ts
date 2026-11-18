import { Port } from './shom-ports';

export const ttl = 7*24*3600;
export const refresh = 24*3600;
export const shomKey = (p:Port) => `shom:reference:v1:${p.ramId}:${p.lon}:${p.lat}`;
export const endpoint = 'https://services.data.shom.fr/INSPIRE/wfs';
const finite = (n:unknown):n is number => typeof n==='number' && Number.isFinite(n);
export type Product = 'ram' | 'vmax';
export interface Reading { fetched:number; high:number; low:number }
export interface Atlas { fetched:number; value:number; id:string }
export interface PortCache { station:string; checked:number; height:Reading|null; current:Atlas|null }

export function productUrl(product:Product,p:Port) {
  const url = new URL(endpoint);
  const args = {service:'WFS', version:'2.0.0',request:'GetFeature',outputFormat:'application/json',count:'2'};
  if (product==='ram') {
    url.search = new URLSearchParams({...args,typeNames:'RAM_BDD_WLD_WGS84G_WFS:ram_3857',resourceId:p.ramId,
      srsName:'urn:ogc:def:crs:OGC:1.3:CRS84'}).toString();
  } else {
    // Explicit CRS84: GeoServer's default EPSG axis order is not necessarily longitude first.
    const filter = `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:gml="http://www.opengis.net/gml/3.2"><fes:Intersects><fes:ValueReference>geom</fes:ValueReference><gml:Point srsName="urn:ogc:def:crs:OGC:1.3:CRS84"><gml:pos>${p.lon} ${p.lat}</gml:pos></gml:Point></fes:Intersects></fes:Filter>`;
    url.search = new URLSearchParams({...args,typeNames:'COURANTS2D_WFS_VMAX:vmax2d_surf',propertyName:'vmax',filter}).toString();
  }
  return url;
}

function single(body:any) {
  if (body?.type!=='FeatureCollection' || body.numberMatched!==1 || body.numberReturned!==1 ||
      !Array.isArray(body.features) || body.features.length!==1) return null;
  const row=body.features[0];
  return row?.type==='Feature' ? row : null;
}

export function readHeight(body:unknown,p:Port,fetched:number):Reading|null {
  const row=single(body), a=row?.properties;
  const coords=row?.geometry?.coordinates;
  if (row?.id!==p.ramId || a?.site!==p.name || row.geometry?.type!=='Point' || !Array.isArray(coords) ||
      coords[0]!==p.lon || coords[1]!==p.lat || !finite(a.phma) || !finite(a.pbma) || a.phma<a.pbma) return null;
  return {high:a.phma,low:a.pbma,fetched};
}

export function readCurrent(body:unknown,fetched:number):Atlas|null {
  const row=single(body);
  if (typeof row?.id!=='string' || !/^vmax2d_surf\.\d+$/.test(row.id) ||
      !finite(row.properties?.vmax) || row.properties.vmax<0) return null;
  return {id:row.id,value:row.properties.vmax,fetched};
}

export function references(record:PortCache|null,p:Port,now=Date.now()) {
  const fresh=(t:number) => finite(t) && t<=now && now<t+ttl*1000;
  const dates=(t:number) => ({fetchedAt:new Date(t).toISOString(),expiresAt:new Date(t+ttl*1000).toISOString()});
  const h=record?.station===shomKey(p) ? record.height:null, c=record?.station===shomKey(p) ? record.current:null;
  return {
    heightReference:h && fresh(h.fetched) && finite(h.high) && finite(h.low) && h.high>=h.low ? {
      source:'shom-ram',kind:'reference',unit:'m',verticalDatum:'local-chart-datum',
      highestAstronomical:h.high,lowestAstronomical:h.low,...dates(h.fetched),
    } : null,
    currentReference:c && fresh(c.fetched) && finite(c.value) && c.value>=0 && /^vmax2d_surf\.\d+$/.test(c.id) ? {
      source:'shom-vmax',kind:'surface-atlas',unit:'kn',coefficient:95,vmaxClass:c.value,featureId:c.id,...dates(c.fetched),
    } : null,
  };
}
