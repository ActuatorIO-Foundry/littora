import {createHash, randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {generateAuthenticationOptions,generateRegistrationOptions,verifyAuthenticationResponse,verifyRegistrationResponse} from '@simplewebauthn/server';
import type {AuthenticationResponseJSON,RegistrationResponseJSON} from '@simplewebauthn/server';

export type Capability = 'contact'|'moderation';
type Actor = {id:string;epoch:string;state:'active'|'enrolling';capability:Capability;can_enroll:boolean};
type Challenge = {value:string;epoch:string;purpose:'enroll'|'login';expires:number};
export const staffCookie='__Host-littora-staff';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const denied=()=>new Error('Private access denied');

export function staffPool(dsn:string) {
  const u=new URL(dsn);
  if(!['postgres:','postgresql:'].includes(u.protocol)||!/^\/littora_staff(_ci_[a-f0-9]{32})?$/.test(u.pathname)) throw denied();
  const pool=new Pool({connectionString:dsn,max:3,connectionTimeoutMillis:2000,statement_timeout:4000});
  pool.on('error',()=>console.error('staff_storage_unavailable'));
  return pool;
}
export async function verifyStaffRole(pool:Pool) {
  const {rows:[r]}=await pool.query(`select pg_has_role(current_user,'littora_staff_runtime','usage') as runtime,
    pg_has_role(current_user,'littora_staff_owner','member') as owner,
    has_table_privilege('staff.account','insert,update,delete,truncate') or has_table_privilege('staff.credential','insert,update,delete,truncate')
    or has_table_privilege('staff.audit','insert,update,delete,truncate') as writable`);
  if(!r.runtime || r.owner || r.writable) throw denied();
}

// A single private listener keeps at most one challenge and one five-minute session per known certificate.
// Restart invalidates both. Rights and epoch are re-read for every private operation.
export class StaffAccess {
  private readonly challenges=new Map<string,Challenge>();
  private readonly sessions=new Map<string,{epoch:string;expires:number;digest:string}>();
  private readonly rpID:string;
  constructor(private readonly db:Pool, readonly origin:string,private readonly now=Date.now) {
    const u=new URL(origin); if(u.protocol!=='https:'||u.origin!==origin) throw denied(); this.rpID=u.hostname;
  }
  async actor(fp:string):Promise<Actor|undefined>{
    if(!/^[0-9A-F]{64}$/.test(fp)) return;
    const result=await this.db.query<Actor>(`select id,epoch,state,capability,enroll_until>now() as can_enroll
      from staff.account where certificate=$1 and state<>'revoked'`,[fp]);
    return result.rows[0];
  }
  async authorized(fp:string,header:string|undefined,capability:Capability){
    const actor=await this.actor(fp),s=this.sessions.get(fp);
    if(!s || !actor || s.epoch!==actor.epoch || s.expires<=this.now() || actor.state!=='active'){
      this.sessions.delete(fp); return false;
    }
    const cookies=(header??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(staffCookie+'='));
    return actor.capability===capability && cookies.length===1 && s.digest===hash(cookies[0].slice(staffCookie.length+1));
  }
  logout(fp:string){ this.sessions.delete(fp); this.challenges.delete(fp); }
  async begin(fp:string){
    const a=await this.actor(fp); if(!a) throw denied();
    const keys=await this.db.query('select id from staff.credential where account_id=$1',[a.id]);
    const enroll=a.state==='enrolling';
    if(enroll ? !a.can_enroll||keys.rowCount===2 : keys.rowCount!==2) throw denied();
    const options=enroll ? await generateRegistrationOptions({
      rpID:this.rpID,rpName:'Littora · gestion privée',userName:a.id,userID:Buffer.from(a.id),
      excludeCredentials:keys.rows.map(({id})=>({id})),attestationType:'none',supportedAlgorithmIDs:[-7,-257],
      authenticatorSelection:{authenticatorAttachment:'cross-platform',userVerification:'required',residentKey:'discouraged'},
    }) : await generateAuthenticationOptions({rpID:this.rpID,userVerification:'required',allowCredentials:keys.rows.map(({id})=>({id}))});
    const purpose=enroll?'enroll':'login';
    this.challenges.set(fp,{value:options.challenge,epoch:a.epoch,purpose,expires:this.now()+60000});
    return {purpose,options};
  }
  async finish(fp:string,response:RegistrationResponseJSON|AuthenticationResponseJSON){
    const c=this.challenges.get(fp); this.challenges.delete(fp);
    const a=await this.actor(fp);
    if(!c || c.expires<=this.now() || !a || a.epoch!==c.epoch) throw denied();
    const expected={expectedChallenge:c.value,expectedOrigin:this.origin,expectedRPID:this.rpID,requireUserVerification:true};
    if(c.purpose==='enroll'){
      if(a.state!=='enrolling' || !a.can_enroll) throw denied();
      const result=await verifyRegistrationResponse({...expected,response:response as RegistrationResponseJSON,supportedAlgorithmIDs:[-7,-257]});
      if(!result.verified || !result.registrationInfo.userVerified || result.registrationInfo.credentialDeviceType!=='singleDevice') throw denied();
      const k=result.registrationInfo.credential;
      await this.db.query('select staff.add_key($1,$2,$3,$4,$5)',[a.id,a.epoch,k.id,Buffer.from(k.publicKey),k.counter]);
      return {enrolled:true} as const;
    }
    if(a.state!=='active') throw denied();
    const {rows:[k]}=await this.db.query('select id,public_key,counter from staff.credential where account_id=$1 and id=$2',[a.id,response.id]);
    if(!k) throw denied();
    const result=await verifyAuthenticationResponse({...expected,response:response as AuthenticationResponseJSON,
      credential:{id:k.id,publicKey:k.public_key,counter:Number(k.counter)}});
    if(!result.verified || !result.authenticationInfo.userVerified || result.authenticationInfo.credentialDeviceType!=='singleDevice') throw denied();
    const {rows:[r]}=await this.db.query('select staff.advance($1,$2,$3,$4,$5) as ok',[a.id,a.epoch,k.id,k.counter,result.authenticationInfo.newCounter]);
    if(!r.ok) throw denied();
    const token=randomBytes(32).toString('base64url');
    this.sessions.set(fp,{epoch:a.epoch,expires:this.now()+300000,digest:hash(token)});
    return {token,capability:a.capability} as const;
  }
}
