import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PG } from '../../database/database.module';
import { AmenityPoint, failureReason, fetchAmenities } from './amenities';

const isExtract = (url?: string) => !!url && (url.startsWith('https://download.openstreetmap.fr/extracts/') ||
  url.startsWith('https://download.geofabrik.de/europe/france/'));
const freshnessMs = (url?: string) => (isExtract(url) ? 48 : 6) * 3600_000;

@Injectable()
export class AmenitiesService {
  private pending=new Map<string,Promise<any>>();
  constructor(@Inject(PG) private db:any) {}

  async get(id:string) {
    if(this.pending.has(id))return this.pending.get(id);
    const task=this.load(id);
    this.pending.set(id,task);
    try{return await task;}finally{this.pending.delete(id);}
  }

  private async load(id:string) {
    const beach=(await this.db.query('select id,lat,lon from beach_catalogue where id=$1',[id])).rows[0];
    if(!beach)throw new NotFoundException('Beach not found');
    const collection=(await this.db.query('select * from beach_amenity_collections where beach_id=$1',[id])).rows[0];
    const samePosition=collection?.lat===beach.lat&&collection?.lon===beach.lon;
    const age=samePosition&&collection.fetched_at?Date.now()-new Date(collection.fetched_at).getTime():Infinity;
    const fresh=age>=0&&age<freshnessMs(collection?.source_url);
    const cooldown=collection&&Date.now()-new Date(collection.attempted_at).getTime()<15*60_000;
    if(!fresh&&!cooldown){
      const endpoint=process.env.OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter';
      let points: AmenityPoint[];
      try{points=await fetchAmenities(beach,endpoint);}
      catch(error){
        const reason=failureReason(error);
        console.warn(JSON.stringify({event:'amenities_unavailable', reason}));
        const code=['configuration','invalid-response'].includes(reason)?reason:'unavailable';
        await this.db.query(`insert into beach_amenity_collections(beach_id,lat,lon,attempted_at,source_url,error_code)
          values($1,$2,$3,now(),'openstreetmap-overpass',$4) on conflict(beach_id) do update
          set attempted_at=excluded.attempted_at,error_code=excluded.error_code`,[id,beach.lat,beach.lon,code]);
        return this.read(id);
      }
      const source=new URL(endpoint);
      await this.persist(beach,points,source.origin+source.pathname);
    }
    return this.read(id);
  }

  async persist(beach:{id:string;lat:number;lon:number},amenities:AmenityPoint[],sourceUrl:string,asOf?:string) {
    const client=await this.db.connect();
    try{
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      const current=(await client.query('select lat,lon from beaches where id=$1 for update',[beach.id])).rows[0];
      if(!current||current.lat!==beach.lat||current.lon!==beach.lon)throw new Error('Beach position changed');
      if(asOf){
        const {rowCount}=await client.query(`select 1 from beach_amenity_collections
          where beach_id=$1 and lat=$2 and lon=$3 and fetched_at >= $4::timestamptz`,[beach.id,beach.lat,beach.lon,asOf]);
        if(rowCount){await client.query('COMMIT');return false;}
      }
      await client.query('delete from beach_amenities where beach_id=$1',[beach.id]);
      await client.query(`insert into beach_amenities(beach_id,osm_id,name,category,lat,lon,source_updated_at)
        select $1,id,name,category,lat,lon,"sourceUpdatedAt" from jsonb_to_recordset($2::jsonb)
        as a(id text,name text,category text,lat double precision,lon double precision,"sourceUpdatedAt" timestamptz)`,[beach.id,JSON.stringify(amenities)]);
      await client.query(`insert into beach_amenity_collections(beach_id,lat,lon,fetched_at,attempted_at,source_url)
        values($1,$2,$3,coalesce($5::timestamptz,now()),now(),$4) on conflict(beach_id) do update set lat=excluded.lat,lon=excluded.lon,
        fetched_at=excluded.fetched_at,attempted_at=excluded.attempted_at,source_url=excluded.source_url,error_code=null`,
        [beach.id,beach.lat,beach.lon,sourceUrl,asOf??null]);
      await client.query('COMMIT');
      return true;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }

  async read(id:string) {
    const collection=(await this.db.query(`select c.* from beach_amenity_collections c join beaches b on b.id=c.beach_id
      and b.lat=c.lat and b.lon=c.lon where c.beach_id=$1`,[id])).rows[0];
    const age=collection?.fetched_at?Date.now()-new Date(collection.fetched_at).getTime():Infinity;
    const usable=age>=0&&age<7*86400_000;
    const rows=usable?(await this.db.query(`select a.osm_id as id,a.name,a.category,a.lat,a.lon,a.source_updated_at as "sourceUpdatedAt",
      ST_Distance(ST_SetSRID(ST_MakePoint(a.lon,a.lat),4326)::geography,ST_SetSRID(ST_MakePoint(b.lon,b.lat),4326)::geography)/1000 as "distanceKm"
      from beach_amenities a join beaches b on b.id=a.beach_id where a.beach_id=$1
      and ST_DWithin(ST_SetSRID(ST_MakePoint(a.lon,a.lat),4326)::geography,ST_SetSRID(ST_MakePoint(b.lon,b.lat),4326)::geography,2500)
      order by "distanceKm",a.osm_id`,[id])).rows:[];
    return {beachId:id,provider:usable?(isExtract(collection.source_url)?'openstreetmap-extract':'openstreetmap-overpass'):'unknown',radiusMeters:2500,
      status:usable?(age>=freshnessMs(collection.source_url)||collection.error_code?'stale':'available'):'unknown',
      fetchedAt:usable?new Date(collection.fetched_at).toISOString():null,
      coverage:'partial',total:rows.length,
      amenities:rows.map((row:any)=>({...row,source:'openstreetmap',verification:'listed',scope:'nearby',
        fetchedAt:new Date(collection.fetched_at).toISOString(),inService:null})),
    };
  }
}
