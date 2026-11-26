import { readFileSync } from 'node:fs';
import { createServer, ServerOptions } from 'node:https';
import type { ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { contactPool, verifyContactRole } from './modules/contact/contact-store';
import {StaffAccess,staffPool,verifyStaffRole} from './staff/staff-access';
import {handleStaffLogin} from './staff/staff-http';
import {ModerationConsole} from './staff/moderation-console';

const root = '/gestion/contact';
const topics: Record<string,string> = {question:'Question',correction:'Donnée à corriger',territory:'Territoire',partnership:'Partenariat'};
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const page = (r: ServerResponse, status: number, content: string) => {
  r.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});
  r.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Boîte de contact | Littora</title><main><h1>Boîte de contact</h1>'+content+'</main></html>');
};

// Separate loopback listener: a session cookie, moderator credential or HTTP header cannot grant mailbox access.
export function managementServer(pool: Pool|undefined, tls: ServerOptions, access:StaffAccess, moderation?:ModerationConsole) {
  const origin=access.origin;
  return createServer({...tls,minVersion:'TLSv1.3',requestCert:true,rejectUnauthorized:true,headersTimeout:10000,requestTimeout:15000}, async (req,res) => {
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Content-Type-Options','nosniff');
    const socket = req.socket as import('node:tls').TLSSocket;
    const fp = socket.getPeerCertificate().fingerprint256?.replace(/:/g,'');
    if (!socket.authorized || !fp) return page(res,403,'Accès réservé.');
    if (req.headers.host !== new URL(origin).host) return page(res,400,'Adresse invalide.');
    try {
      const actor=await access.actor(fp);
      if(!actor)return page(res,403,'Accès réservé.');
      if(await handleStaffLogin(req,res,access,fp))return;
      const mod=req.url==='/gestion/moderation'||req.url?.startsWith('/gestion/moderation/');
      const capability=mod?'moderation':'contact';
      if(actor.capability!==capability)return page(res,403,'Accès réservé.');
      if(!await access.authorized(fp,req.headers.cookie,capability))
        return page(res,401,'<a href="/gestion/connexion">Confirmer avec ma clé de sécurité</a>');
      if(mod){
        if(!moderation)return page(res,503,'Modération indisponible.');
        return await moderation.handle(req,res,actor.id,origin,()=>access.authorized(fp,req.headers.cookie,'moderation'));
      }
      if(!pool)return page(res,503,'Boîte indisponible.');
      await verifyContactRole(pool,true);
      if (req.method === 'GET' && req.url === root) {
        const list = await pool.query('select * from inbox.open_mail()');
        return page(res,200,(list.rows.length ? '<p>Les 50 plus anciennes demandes non traitées, au maximum.</p><ul>'+
          list.rows.map(m => '<li><a href="'+root+'/'+m.reference+'">'+m.received_at.toISOString().slice(0,10)+' · '+esc(topics[m.topic])+' · '+m.reference+'</a></li>').join('')+'</ul>' : '<p>Aucune demande en attente.</p>')+
          '<form method="post" action="/gestion/connexion/quitter"><button>Fermer la session</button></form>');
      }
      const match = /^\/gestion\/contact\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})(\/traiter)?$/.exec(req.url ?? '');
      if (!match) return page(res,404,'Demande introuvable.');
      const id = match[1];
      if (req.method === 'GET' && !match[2]) {
        const {rows:[m]} = await pool.query('select * from inbox.read_mail($1)',[id]);
        if (!m) return page(res,404,'Demande introuvable.');
        return page(res,200,'<p><a href="'+root+'">Toutes les demandes</a></p><h2>'+esc(topics[m.topic])+'</h2><p>'+esc(m.email)+'</p><div>'+esc(m.body).replace(/\r?\n/g,'<br>')+
          '</div><p>Référence : '+id+'</p><form method="post" action="'+root+'/'+id+'/traiter"><button>Terminer et supprimer le message</button></form>');
      }
      if (req.method === 'POST' && match[2]) {
        if (req.headers.origin !== origin || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) return page(res,403,'Origine refusée.');
        const {rows:[r]} = await pool.query('select inbox.resolve($1) as done',[id]);
        if (!r.done) return page(res,404,'Demande introuvable.');
        res.writeHead(303,{location:root}); res.end(); return;
      }
      return page(res,405,'Méthode non autorisée.');
    } catch { return page(res,503,'Boîte indisponible.'); }
  });
}

async function main() {
  const required = (k:string) => {const v=process.env[k]; if (!v) throw new Error('Missing private inbox configuration'); return v;};
  const pool = process.env.CONTACT_MANAGE_DATABASE_URL ? contactPool(process.env.CONTACT_MANAGE_DATABASE_URL) : undefined;
  const staff=staffPool(required('STAFF_DATABASE_URL'));
  const moderation=new ModerationConsole(process.env.STAFF_MODERATOR_DATABASES_FILE ?
    JSON.parse(readFileSync(process.env.STAFF_MODERATOR_DATABASES_FILE,'utf8')) : {});
  const close=()=>Promise.all([pool?.end(),staff.end(),moderation.close()]);
  try {
    if(pool)await verifyContactRole(pool,true);
    await verifyStaffRole(staff);
    const origin = required('CONTACT_MANAGE_ORIGIN');
    const server = managementServer(pool,{
      cert:readFileSync(required('CONTACT_TLS_CERT_FILE')),key:readFileSync(required('CONTACT_TLS_KEY_FILE')),
      ca:readFileSync(required('CONTACT_CLIENT_CA_FILE')),
    },new StaffAccess(staff,origin),moderation);
    const port = Number(new URL(origin).port || 443);
    server.on('error', () => {console.error('contact_private_listener_failed'); process.exitCode=1; void close();});
    server.listen(port,'127.0.0.1');
    process.once('SIGTERM',()=>server.close(()=>void close()));
  } catch (err) { await close(); throw err; }
}
if (require.main === module) main().catch(()=>{console.error('contact_private_start_failed'); process.exitCode=1;});
