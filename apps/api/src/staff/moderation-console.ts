import type {IncomingMessage,ServerResponse} from 'node:http';
import {Pool} from 'pg';
import {sameOrigin} from './staff-http';

const root='/gestion/moderation';
const actions:Record<string,string>={publish:'Publier',reject:'Rejeter',dismiss:'Classer la contestation',uphold:'Accepter la contestation',withdraw:'Retirer'};
const reasons:Record<string,string>={consistent:'Cohérent',incorrect:'Incorrect',duplicate:'Doublon',unverifiable:'Non vérifiable',outdated:'Périmé'};
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export class ModerationConsole {
  private readonly pools=new Map<string,Pool>();
  constructor(locations:Record<string,string>){
    for(const [id,dsn] of Object.entries(locations)){
      if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))throw Error('Invalid actor configuration');
      const url=new URL(dsn);
      if(!['postgres:','postgresql:'].includes(url.protocol)||url.username!=='staff_'+id.replace(/-/g,''))throw Error('Invalid moderator login');
      const pool=new Pool({connectionString:dsn,max:1,connectionTimeoutMillis:2000,statement_timeout:4000});
      pool.on('error',()=>console.error('staff_moderation_unavailable'));this.pools.set(id,pool);
    }
  }
  async close(){await Promise.all([...this.pools.values()].map(p=>p.end()));}
  async handle(req:IncomingMessage,res:ServerResponse,id:string,origin:string,stillAuthorized:()=>Promise<boolean>){
    const pool=this.pools.get(id);
    const page=(n:number,html:string)=>{res.writeHead(n,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Modération | Littora</title><main><h1>Modération</h1>'+html+'</main></html>');};
    if(!pool)return page(403,'Aucune habilitation.');
    const {rows:[r]}=await pool.query(`select session_user as login,has_function_privilege('moderation.decide(uuid,text,text)','execute') as decide,
      has_table_privilege('public.reports','select,insert,update,delete') or has_table_privilege('moderation.decisions','insert,update,delete') as broad`);
    if(r.login!=='staff_'+id.replace(/-/g,'')||!r.decide||r.broad)return page(403,'Habilitation invalide.');
    if(req.url===root && req.method==='GET'){
      const {rows}=await pool.query('select id,beach,type,value,disputed_type from moderation.queue order by created_at,id limit 50');
      const options=(codes:string[],labels:Record<string,string>)=>codes.map(c=>'<option value="'+c+'">'+labels[c]+'</option>').join('');
      return page(200,(rows.map(m=>'<article><h2>'+esc(m.beach)+'</h2><p>'+esc(m.type)+' : '+esc(JSON.stringify(m.value))+'</p><form action="'+root+'/'+m.id+'" method="post"><label>Décision <select name="action">'+
        options(m.disputed_type?['dismiss','uphold']:['publish','reject'],actions)+'</select></label><label>Motif <select name="reason">'+options(Object.keys(reasons),reasons)+'</select></label><button>Confirmer</button></form></article>').join('')||'<p>Aucun dossier en attente.</p>')+
        '<details><summary>Retirer une observation publiée</summary><form method="post" action="'+root+'"><label>Référence de l’observation <input name="report" required maxlength="36"></label>'+
        '<label>Motif du retrait <select name="reason">'+options(Object.keys(reasons),reasons)+'</select></label><button>Retirer la publication</button></form></details>'+
        '<form method="post" action="/gestion/connexion/quitter"><button>Fermer la session</button></form>');
    }
    const match=/^\/gestion\/moderation\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(req.url??'');
    if((!match&&req.url!==root)||req.method!=='POST')return page(404,'Dossier introuvable.');
    if(!sameOrigin(req,origin)||req.headers['content-type']!=='application/x-www-form-urlencoded')return page(403,'Origine refusée.');
    let body='';for await(const chunk of req){body+=chunk.toString();if(body.length>256)return page(400,'Décision invalide.');}
    const form=new URLSearchParams(body),action=match?(form.get('action')??''):'withdraw',reason=form.get('reason')??'';
    const report=match?.[1]??form.get('report')??'';
    if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(report)||!Object.keys(actions).includes(action)||!Object.keys(reasons).includes(reason))return page(400,'Décision invalide.');
    if(!await stillAuthorized())return page(403,'Confirmation par clé requise.');
    try{await pool.query('select moderation.decide($1,$2,$3)',[report,action,reason]);}
    catch(e){if(['P0002','55000'].includes((e as {code:string}).code))return page(409,'Ce dossier ne peut plus être traité.');throw e;}
    res.writeHead(303,{location:root});res.end();
  }
}
