import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PG } from '../../database/database.module';
import { AmenityPoint, fetchAmenities } from './amenities';

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
    const fresh=samePosition&&Date.now()-new Date(collection.fetched_at).getTime()<6*3600_000;
    const cooldown=collection&&Date.now()-new Date(collection.attempted_at).getTime()<15*60_000;
    if(!fresh&&!cooldown){
      const endpoint=process.env.OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter';
      try{await this.persist(beach,await fetchAmenities(beach,endpoint),endpoint);}
      catch(error){
        const code=error instanceof Error&&['configuration','invalid-response'].includes(error.message)?error.message:'unavailable';
        await this.db.query(`insert into beach_amenity_collections(beach_id,lat,lon,attempted_at,source_url,error_code)
          values($1,$2,$3,now(),'openstreetmap-overpass',$4) on conflict(beach_id) do update
          set attempted_at=excluded.attempted_at,error_code=excluded.error_code`,[id,beach.lat,beach.lon,code]);
      }
    }
    return this.read(id);
  }

  async persist(beach:{id:string;lat:number;lon:number},amenities:AmenityPoint[],sourceUrl:string) {
    const client=await this.db.connect();
    try{
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      const current=(await client.query('select lat,lon from beaches where id=$1 for share',[beach.id])).rows[0];
      if(!current||current.lat!==beach.lat||current.lon!==beach.lon)throw new Error('Beach position changed');
      await client.query('delete from beach_amenities where beach_id=$1',[beach.id]);
      await client.query(`insert into beach_amenities(beach_id,osm_id,name,category,lat,lon,source_updated_at)
        select $1,id,name,category,lat,lon,"sourceUpdatedAt" from jsonb_to_recordset($2::jsonb)
        as a(id text,name text,category text,lat double precision,lon double precision,"sourceUpdatedAt" timestamptz)`,[beach.id,JSON.stringify(amenities)]);
      await client.query(`insert into beach_amenity_collections(beach_id,lat,lon,fetched_at,attempted_at,source_url)
        values($1,$2,$3,now(),now(),$4) on conflict(beach_id) do update set lat=excluded.lat,lon=excluded.lon,
        fetched_at=excluded.fetched_at,attempted_at=excluded.attempted_at,source_url=excluded.source_url,error_code=null`,
        [beach.id,beach.lat,beach.lon,sourceUrl]);
      await client.query('COMMIT');
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
    return {beachId:id,provider:usable?'openstreetmap-overpass':'unknown',radiusMeters:2500,
      status:usable?(age>6*3600_000||collection.error_code?'stale':'available'):'unknown',
      fetchedAt:usable?new Date(collection.fetched_at).toISOString():null,
      coverage:'partial',total:rows.length,
      amenities:rows.map((row:any)=>({...row,source:'openstreetmap',verification:'listed',scope:'nearby',
        fetchedAt:new Date(collection.fetched_at).toISOString(),inService:null})),
    };
  }
}
