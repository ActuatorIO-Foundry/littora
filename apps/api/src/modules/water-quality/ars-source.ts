import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';

const base = 'https://static.data.gouv.fr/resources/donnees-de-rapportage-de-la-saison-balneaire-1/';
export const season = 2025;
export const resources = {
  sites: ['27c2535a-4ba9-4f48-9ba5-e5d6ca97f750','20251215-174117/liste-des-sites-de-baignade-saison-2025-opendata-v2.csv','e0c97f20f4e99e695e686a3e86e66b17b8ddfdfd0451cf54a0264a8ac34b07a1'],
  samples: ['04646950-b1e1-4ea7-903f-82683da096c4','20260625-080706/saison-balneaire-2025-resultats-danalyses.csv','758d3276086731331d398c83a4fd61ac82cd96696eb08969afbcffc02e07dec7'],
  classes: ['1d23bd32-e287-4d08-a611-563f27ce0048','20260625-080712/saison-balneaire-2025-caracteristiques-des-sites-de-baignade.csv','0ddbc5cefb1ef82de379837dfb67d63a06f1bf7143893dc1027e78a45fc6dfcd'],
  events: ['c170be66-e5b3-48e8-94b3-383793144040','20260625-080717/saison-balneaire-2025-informations-sur-la-saison.csv','d45eaeb4e578eaebb91866ecc6f42a9945e13eb51253aa3f9bfd8cf2c61118e2'],
} as const;
export type Product = keyof typeof resources;
export const products = Object.keys(resources) as Product[];
export const edition = createHash('sha256').update(products.map(p=>resources[p][2]).join(':')).digest('hex');
export const sourceUrl = (product: Product) => base + resources[product][1];

export async function download(product: Product): Promise<Buffer> {
  const res = await fetch(sourceUrl(product),{redirect:'error',signal:AbortSignal.timeout(45000)});
  const limit = 8 * 1024 * 1024;
  if (!res.ok || !res.body || Number(res.headers.get('content-length')) > limit) {
    await res.body?.cancel(); throw Error('ARS resource unavailable: '+product);
  }
  const reader=res.body.getReader(), chunks:Buffer[]=[]; let size=0;
  try {
    for (;;) {
      const {value,done}=await reader.read(); if(done)break;
      if((size+=value.length)>limit){ await reader.cancel();throw Error('ARS resource too large'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function decodeResource(p: Product, bytes:Buffer):string[][] {
  if(createHash('sha256').update(bytes).digest('hex')!==resources[p][2]) throw Error('ARS checksum mismatch: '+p);
  // The approved releases have Latin-1 headers with literal quotes in unquoted fields.
  const [header,...rows]:string[][]=parse(bytes.toString('latin1'),{delimiter:';',relax_quotes:true,skip_empty_lines:true,max_record_size:16384});
  if(header[3]!=="Code unique d'identification du site de baignade" || header.length!==({sites:13,samples:11,events:9,classes:9})[p])
    throw Error('Unrecognized ARS schema: '+p);
  return rows;
}

export function officialDate(s:string):string|null {
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); if(!m)return null;
  const date=m[3]+'-'+m[2]+'-'+m[1], t=Date.parse(date+'T00:00:00Z');
  return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===date?date:null;
}
export function measurement(raw:string, status:string) {
  if(status==='Valeur manquante')return {value:null,qualifier:'missing'};
  if(!/^\d+(?:[.,]\d+)?$/.test(raw)||!['Valeur confirmée','Limite de détection'].includes(status)) throw Error('invalid measurement');
  const value=Number(raw.replace(',','.')); if(!Number.isFinite(value))throw Error('invalid measurement');
  return {value,qualifier:status==='Valeur confirmée'?'confirmed':'detection-limit'};
}
