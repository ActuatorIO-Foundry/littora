import { BadRequestException, HttpException, Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import { contactPool, verifyContactRole } from './contact-store';

@Injectable()
export class ContactStore implements OnModuleDestroy {
  private readonly key = process.env.CONTACT_QUOTA_KEY;
  private readonly pool?: Pool;
  constructor() {
    if (this.key && /^[a-f0-9]{64}$/i.test(this.key) && process.env.CONTACT_SUBMIT_DATABASE_URL) {
      try { this.pool = contactPool(process.env.CONTACT_SUBMIT_DATABASE_URL); }
      catch { console.error('contact_configuration_unavailable'); }
    }
  }
  async available() {
    if (!this.pool) return false;
    try {
      await verifyContactRole(this.pool,false);
      return (await this.pool.query('select inbox.available() as ok')).rows[0].ok === true;
    } catch { return false; }
  }
  async submit(data: {email:string;topic:string;message:string}, address:string) {
    if (!this.pool || !this.key) throw new ServiceUnavailableException();
    if (!data.message.trim() || [data.email,data.message].some(v => v.includes('\u0000'))) throw new BadRequestException();
    const bucket = createHmac('sha256',this.key).update(new Date().toISOString().slice(0,13)).update(':').update(address).digest('hex');
    try {
      await verifyContactRole(this.pool,false);
      const {rows:[receipt]} = await this.pool.query('select inbox.submit($1,$2,$3,$4) as reference',[data.email,data.topic,data.message.trim(),bucket]);
      return receipt;
    } catch (err) {
      if ((err as {code?:string}).code === 'P0429') throw new HttpException('Too many submissions',429);
      throw new ServiceUnavailableException();
    }
  }
  @Interval(15 * 60_000)
  async purge() {
    if (!this.pool) return;
    try { await verifyContactRole(this.pool,false); await this.pool.query('select inbox.purge()'); }
    catch { console.error('contact_purge_unavailable'); }
  }
  async onModuleDestroy() { await this.pool?.end(); }
}
