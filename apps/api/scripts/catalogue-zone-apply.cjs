// A single transaction evaluates the whole zone before inserting anything. Existing rows are never edited.
async function applyZone(pool,commune,candidates,commit) {
  const c=await pool.connect();
  try {
    await c.query('begin');
    await c.query("set local lock_timeout='5s'");
    await c.query("set local statement_timeout='120s'");
    if(commit) await c.query('lock table beaches in share row exclusive mode');
    const geometry=JSON.stringify(commune.contour);
    const shape=(await c.query('select ST_IsValid(g) valid,ST_GeometryType(g) kind from (select ST_GeomFromGeoJSON($1) g)s',[geometry])).rows[0];
    if(!shape.valid||!['ST_Polygon','ST_MultiPolygon'].includes(shape.kind))throw Error('Invalid commune outline');
    await c.query(`create temp table zone_candidates(id text primary key check(id ~ '^(node|way|relation)/[1-9][0-9]*$'),
      name text not null,lat double precision not null check(lat between -90 and 90),
      lon double precision not null check(lon between -180 and 180),point geography(Point,4326) not null,outcome text) on commit drop`);
    await c.query(`insert into zone_candidates(id,name,lat,lon,point)
      select id,name,lat,lon,ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography
      from jsonb_to_recordset($1) r(id text,name text,lat double precision,lon double precision)`,[JSON.stringify(candidates)]);
    await c.query('create index on zone_candidates using gist(point)');
    await c.query(`update zone_candidates set outcome=case
      when not catalogue_in_metropolitan_france(lat,lon) then 'outside_france'
      when not ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON($1),4326),point::geometry) then 'outside_commune' end`,[geometry]);
    await c.query(`update zone_candidates z set outcome=case
      when lower(b.name)=lower(z.name) and ST_DWithin(ST_SetSRID(ST_MakePoint(b.lon,b.lat),4326)::geography,z.point,5)
      then 'existing' else 'review_identity' end from beaches b where z.outcome is null and b.osm_id=z.id`);
    // Flag both members of a potential duplicate pair. Distance alone never merges their identities.
    await c.query(`update zone_candidates z set outcome='review_proximity' where z.outcome is null and (
      exists(select 1 from beaches b where ST_DWithin(ST_SetSRID(ST_MakePoint(b.lon,b.lat),4326)::geography,z.point,
        case when lower(b.name)=lower(z.name) then 250 else 25 end))
      or exists(select 1 from zone_candidates t where t.id<>z.id and t.outcome is null and ST_DWithin(t.point,z.point,250)
        and (lower(t.name)=lower(z.name) or ST_DWithin(t.point,z.point,25))))`);
    if(commit)await c.query(`insert into beaches(osm_id,name,lat,lon,geom,city,department,region,has_parking,has_toilets,has_lifeguard)
      select id,name,lat,lon,point,$1,$2,$3,null,null,null from zone_candidates where outcome is null`,
      [commune.nom,commune.departement.nom,commune.region.nom]);
    const result=await c.query('select id,coalesce(outcome,$1) outcome from zone_candidates order by id',[commit?'inserted':'would_insert']);
    await c.query(commit?'commit':'rollback');
    return result.rows;
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
}
module.exports={applyZone};
