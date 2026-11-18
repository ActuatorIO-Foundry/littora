import { haversineKm } from '../../shared/geo';

export interface Port { name:string; slug:string; ramId:string; lat:number; lon:number }
export const ports: readonly Port[] = [
  { name:'Calais', slug:'CALAIS', ramId:'ram_3857.5', lat:50.969333, lon:1.8675 },
  { name:'Saint-Malo', slug:'SAINT-MALO', ramId:'ram_3857.39', lat:48.641167, lon:-2.0275 },
  { name:'Brest', slug:'BREST', ramId:'ram_3857.87', lat:48.3825, lon:-4.494722 },
  { name:'La Rochelle - La Pallice', slug:'LA_ROCHELLE-PALLICE', ramId:'ram_3857.159', lat:46.16, lon:-1.221667 },
  { name:'Arcachon', slug:'ARCACHON_EYRAC', ramId:'ram_3857.186', lat:44.664333, lon:-1.163667 },
  { name:'Marseille (Corniche)', slug:'MARSEILLE', ramId:'ram_3857.206', lat:43.278789, lon:5.353736 },
  { name:'Toulon', slug:'TOULON', ramId:'ram_3857.196', lat:43.122678, lon:5.914669 },
  { name:'Ajaccio', slug:'AJACCIO', ramId:'ram_3857.224', lat:41.922703, lon:8.762839 },
];

export function matchPort(lat:number,lon:number,harbor?:string) {
  const normalize = (s:string) => s.trim().toUpperCase().replace(/[-_ ]+/g,' ');
  const options = ports.map(port=>({port,distanceKm:haversineKm(lat,lon,port.lat,port.lon)}))
    .filter(({port,distanceKm})=>distanceKm<=5 && (!harbor ||
      [port.slug,port.name].some(s=>normalize(s)===normalize(harbor))));
  return options.length===1 ? options[0] : null;
}
