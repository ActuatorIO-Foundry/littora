import type { Pool } from 'pg';
import type { Source } from '../shared/forecast-data';

type SourceDispatch = {
  source: Source; zones: number; neverCollected: number; stale: number; errors: number;
  due: number; overdue: number; lastAttemptAt: Date | null; lastSuccessAt: Date | null; dispatchDelayed: boolean;
};
export async function readDispatch(db: Pick<Pool, 'query'>) {
  return (await db.query<SourceDispatch>(`select t.source,count(*)::int as zones,
    count(*) filter(where z.last_success_at is null)::int as "neverCollected",
    count(*) filter(where z.last_success_at<=now()-interval '6 hours')::int as stale,
    count(*) filter(where z.error_code is not null)::int as errors,
    count(*) filter(where z.next_check_at is null or z.next_check_at<=now())::int as due,
    count(*) filter(where z.next_check_at<now()-interval '5 minutes')::int as overdue,
    max(z.last_attempt_at) as "lastAttemptAt",max(z.last_success_at) as "lastSuccessAt",
    (select next_request_at>now() + interval '15 seconds' from forecast_dispatch where singleton) as "dispatchDelayed"
    from forecast_targets t left join forecast_zones z using(source,y,x) group by t.source order by t.source`)).rows;
}
