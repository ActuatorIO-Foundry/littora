import { ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { PG } from '../../database/database.module';

export interface ContributionIdentity { token?: string; address?: string }

@Injectable()
export class ContributionsService {
  constructor(@Inject(PG) private db: any) {}

  @Interval(3600_000)
  async purgeExpired() {
    try {
      await this.transaction(client => this.purge(client));
    } catch { Logger.warn({event:'contribution_retention_unavailable'},'Contributions'); }
  }

  private async purge(client: any) {
    await client.query('delete from report_rate_limits where expires_at<now()');
    await client.query('delete from report_contributors where expires_at<now()');
    await client.query("update report_contributions set network_hash=null where network_hash is not null and observed_at<now()-interval '24 hours'");
  }

  private network(address?: string): string {
    const key = process.env.REPORT_IP_HASH_KEY;
    if (!key || key.length < 32 || /\s/.test(key) || !address || !isIP(address)) {
      throw new ServiceUnavailableException();
    }
    // An HMAC avoids storing addresses or allowing offline enumeration of IPv4 space.
    return createHmac('sha256', key).update('report-network:' + address).digest('hex');
  }

  private async transaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
    let client: any;
    try { client = await this.db.connect(); }
    catch { throw new ServiceUnavailableException(); }
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='3s'");
      await client.query("SET LOCAL statement_timeout='5s'");
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException();
    } finally { client.release(); }
  }

  private async quota(client: any, subject: string, kind: string, seconds: number, limit: number) {
    const bucket = Math.floor(Date.now() / (seconds * 1000));
    const key = `${kind}:${subject}:${bucket}`;
    const expires = new Date((bucket + 1) * seconds * 1000);
    const { rows } = await client.query(`insert into report_rate_limits(key,count,expires_at) values($1,1,$2)
      on conflict(key) do update set count=report_rate_limits.count+1 where report_rate_limits.count<$3 returning count`,
      [key, expires, limit]);
    if (!rows.length) throw new HttpException('Too many requests', 429);
  }

  async session(address?: string) {
    const network = this.network(address);
    const token = randomBytes(32).toString('hex');
    return this.transaction(async client => {
      await this.quota(client, network, 'session-hour', 3600, 3);
      await this.quota(client, network, 'session-day', 86400, 8);
      await this.purge(client);
      const { rows } = await client.query('insert into report_contributors(token_hash) values($1) returning expires_at',
        [createHash('sha256').update(token).digest('hex')]);
      return { token, expiresAt: new Date(rows[0].expires_at).toISOString() };
    });
  }

  async submit(dto: { beachId: string; type: string; value: Record<string,string>; observedAt: string }, identity: ContributionIdentity) {
    const network = this.network(identity.address);
    const token = identity.token ?? '';
    if (!/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return this.transaction(async client => {
      const actor = (await client.query('select id from report_contributors where token_hash=$1 and expires_at>now() for share', [tokenHash])).rows[0];
      if (!actor) throw new UnauthorizedException();
      if (!(await client.query(`select id from beaches where id=$1
        and exists(select 1 from beach_catalogue c where c.id=beaches.id) for key share`, [dto.beachId])).rows.length) throw new NotFoundException();
      if (dto.value.contests && !(await client.query(`select r.id from reports r
        left join report_contributions c on c.report_id=r.id
        where r.id=$1 and r.beach_id=$2 and r.status='verified' and coalesce(r.value->>'demo','false')<>'true'
        and coalesce(c.observed_at,r.created_at)<=now() and coalesce(c.expires_at,r.created_at+interval '24 hours')>now()
        for share of r`, [dto.value.contests,dto.beachId])).rowCount) throw new NotFoundException();
      // Serialise both network and actor, including submissions from different API instances.
      for (const key of [network, actor.id].sort()) await client.query('select pg_advisory_xact_lock(hashtextextended($1,23))', [key]);
      const duplicate = await client.query(`select r.id from reports r join report_contributions c on c.report_id=r.id
        where r.beach_id=$1 and r.type=$2 and (c.contributor_id=$3 or c.network_hash=$4)
        and r.created_at>now()-interval '15 minutes' limit 1`, [dto.beachId,dto.type,actor.id,network]);
      if (duplicate.rows.length) throw new ConflictException();
      await this.quota(client, network, 'report-network-hour', 3600, 15);
      await this.quota(client, network, 'report-network-day', 86400, 40);
      await this.quota(client, actor.id, 'report-actor-ten-minutes', 600, 3);
      await this.quota(client, actor.id, 'report-actor-day', 86400, 20);
      const row = (await client.query(`insert into reports(beach_id,type,value,confidence,status)
        values($1,$2,$3,0,'pending') returning *`, [dto.beachId,dto.type,dto.value])).rows[0];
      const metadata = (await client.query(`insert into report_contributions(report_id,contributor_id,network_hash,observed_at,expires_at)
        values($1,$2,$3,$4,$4::timestamptz+interval '24 hours') returning observed_at,expires_at`,
        [row.id,actor.id,network,dto.observedAt])).rows[0];
      return { ...row, ...metadata };
    });
  }
}
