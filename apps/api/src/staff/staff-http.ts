import {randomBytes} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {StaffAccess,staffCookie} from './staff-access';

const base='/gestion/connexion';
const client=`
document.querySelector('button').onclick=async function(){
  this.disabled=true;
  const status=document.querySelector('[role=status]');
  try {
    const post=async(path,body)=>{const r=await fetch('/gestion/connexion/'+path,{method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error();return r.json()};
    const {purpose,options}=await post('options',{});
    const create=purpose==='enroll';
    const credential=create?await navigator.credentials.create({publicKey:PublicKeyCredential.parseCreationOptionsFromJSON(options)}):
      await navigator.credentials.get({publicKey:PublicKeyCredential.parseRequestOptionsFromJSON(options)});
    const result=await post('verifier',credential.toJSON());
    if(result.enrolled) status.textContent='Clé enregistrée. Présentez votre seconde clé si nécessaire, puis faites confirmer votre habilitation.';
    else location.assign(result.capability==='contact'?'/gestion/contact':'/gestion/moderation');
  } catch { status.textContent='Accès non confirmé. Vérifiez votre clé et votre habilitation.'; }
  finally {this.disabled=false;}
};`;
const json=(res:ServerResponse,status:number,data:unknown)=>{
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
};
export const sameOrigin=(req:IncomingMessage,origin:string)=>req.headers.origin===origin &&
  (!req.headers['sec-fetch-site']||req.headers['sec-fetch-site']==='same-origin');

export async function handleStaffLogin(req:IncomingMessage,res:ServerResponse,access:StaffAccess,fp:string){
  if(req.url!==base && !req.url?.startsWith(base+'/')) return false;
  if(req.method==='GET' && req.url===base){
    const nonce=randomBytes(20).toString('base64');
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accès privé | Littora</title><main><h1>Accès privé Littora</h1><button>Utiliser ma clé de sécurité</button><p role="status"></p></main><script nonce="'+nonce+'">'+client+'</script></html>');return true;
  }
  if(req.method!=='POST'||!sameOrigin(req,access.origin)){json(res,403,{ok:false});return true;}
  if(req.url===base+'/quitter'){
    access.logout(fp);res.setHeader('Set-Cookie',staffCookie+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict');
    res.writeHead(303,{location:base});res.end();return true;
  }
  if(![base+'/options',base+'/verifier'].includes(req.url??'')){json(res,404,{ok:false});return true;}
  if(req.headers['content-type']?.split(';')[0]!=='application/json'){json(res,415,{ok:false});return true;}
  try {
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>32768){json(res,413,{ok:false});return true;}chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(req.url===base+'/options'){json(res,200,await access.begin(fp));return true;}
    const result=await access.finish(fp,body);
    if(result.token){
      res.setHeader('Set-Cookie',staffCookie+'='+result.token+'; Path=/; Max-Age=300; Secure; HttpOnly; SameSite=Strict');
      json(res,200,{capability:result.capability});
    }else json(res,200,{enrolled:true});
  } catch {json(res,403,{ok:false});}
  return true;
}
