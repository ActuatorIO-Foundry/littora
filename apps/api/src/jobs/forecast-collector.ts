import { Pool } from 'pg';
import { normalizeForecast, readForecast, refreshSeconds, Source, sources } from '../shared/forecast-data';
import { ScoreService } from '../modules/score/score.service';
import { ForecastCollectionFailure } from './collection-signals';

type Target = { source: Source; x: number; y: number; failures: number };
export class ProviderFailure extends Error {
  constructor(readonly code: string, readonly retryAfter = 0) { super(code); }
}

export async function fetchZone(target: Target, request = fetch) {
  const { endpoint, keys } = sources[target.source];
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ latitude: String(target.y/100), longitude: String(target.x/100),
    hourly: keys.join(','), forecast_days: '3', timezone: 'GMT', timeformat: 'unixtime' }).toString();
  const signal = AbortSignal.timeout(8000);
  try {
    const res = await request(url, { signal, redirect: 'error' });
    if (!res.ok) {
      const header = res.headers.get('retry-after') ?? '';
      const wait = /^\d+$/.test(header) ? Number(header) : (Date.parse(header)-Date.now())/1000;
      await res.body?.cancel();
      throw new ProviderFailure('http_' + res.status, Number.isFinite(wait) ? Math.max(0,Math.ceil(wait)) : 0);
    }
    const payload = normalizeForecast(target.source, await res.json());
    const now = new Date(Date.now());
    if (readForecast(target.source, { payload, last_success_at: now, next_check_at: now, error_code: null }).status === 'unknown')
      throw new ProviderFailure('empty');
    return payload;
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    throw new ProviderFailure(signal.aborted ? 'timeout' : error instanceof TypeError ? 'network' : 'empty');
  }
}

export function retryPolicy(failure: ProviderFailure, failures: number) {
  const transient = ['network','timeout','http_429'].includes(failure.code) || failure.code.startsWith('http_5');
  const pause = failure.code === 'http_429' ? Math.max(300, failure.retryAfter)
    : transient ? Math.max(30, failure.retryAfter) : 0;
  const retry = transient && failures < 3 ? 60 * (2 ** failures) : refreshSeconds;
  return { pause, delay: Math.max(retry, pause) };
}

// The transaction is short: lease and quota are committed before the first network byte.
async function claim(db: Pool): Promise<Target | undefined> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const gate = await client.query(`update forecast_dispatch set next_request_at=now()+interval '12 seconds'
      where singleton and next_request_at<=now() returning singleton`);
    let target: Target | undefined;
    if (gate.rowCount) {
      const result = await client.query<Target>(`select t.*, coalesce(z.failures,0) as failures from forecast_targets t
        left join forecast_zones z using(source,y,x) where z.next_check_at is null or z.next_check_at<=now()
        order by z.next_check_at nulls first,t.y,t.x,t.source limit 1`);
      target = result.rows[0];
      if (target) await client.query(`insert into forecast_zones(source,y,x,last_attempt_at,next_check_at)
        values($1,$2,$3,now(),now()+interval '2 minutes') on conflict(source,y,x) do update
        set last_attempt_at=excluded.last_attempt_at,next_check_at=excluded.next_check_at`, [target.source,target.y,target.x]);
    }
    await client.query('commit');
    return target;
  } catch (e) { await client.query('rollback'); throw e; }
  finally { client.release(); }
}

export async function collectOne(db: Pool, request = fetch) {
  const t = await claim(db);
  if (!t) return { collected: 0 };
  const args = [t.source,t.y,t.x];
  let payload;
  try { payload = await fetchZone(t, request); }
  catch (e) {
    if (!(e instanceof ProviderFailure)) throw e;
    const { pause, delay } = retryPolicy(e,t.failures);
    await db.query(`with paused as (update forecast_dispatch set next_request_at=greatest(next_request_at,
      now()+make_interval(secs=>$6::double precision)) where singleton and $6::double precision>0)
      update forecast_zones set failures=least(failures+1,3), error_code=$4,
      next_check_at=now()+make_interval(secs=>$5) where source=$1 and y=$2 and x=$3`, [...args,e.code,delay,pause]);
    throw new ForecastCollectionFailure(t.source, e.code);
  }
  await db.query(`update forecast_zones set payload=$4,last_success_at=now(),error_code=null,failures=0,
    next_check_at=now()+make_interval(secs=>$5) where source=$1 and y=$2 and x=$3`, [...args,payload,refreshSeconds]);
  return { collected: 1, source: t.source };
}

export async function projectDue(db: Pool, score: ScoreService) {
  const { rows } = await db.query(`select b.id from beach_catalogue b left join forecast_projections p on p.beach_id=b.id
    where exists(select 1 from forecast_zones z where z.y=floor(b.lat*100+0.5)::int and z.x=floor(b.lon*100+0.5)::int
      and z.last_success_at>now()-interval '24 hours' and (z.source='open-meteo' or b.water_type='sea')
      and (p.updated_at is null or p.updated_at < now()-interval '8 minutes' or z.last_success_at > p.updated_at))
    order by p.updated_at nulls first,b.id limit 100`);
  let failed = 0;
  for (const { id } of rows) {
    try { await score.scoreBeach(id, true); } catch { failed++; }
    // Rotate even on error so a broken site cannot starve the rest of the catalogue.
    await db.query(`insert into forecast_projections values ($1,now()) on conflict(beach_id)
      do update set updated_at=excluded.updated_at`, [id]);
  }
  if (failed) throw new Error(`Failed search projections: ${failed}/${rows.length}`);
  return { projected: rows.length };
}
