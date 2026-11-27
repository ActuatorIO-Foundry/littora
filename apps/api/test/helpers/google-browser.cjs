const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {execFileSync} = require('node:child_process');
const {mkdtempSync,readFileSync,rmSync} = require('node:fs');
const {createServer} = require('node:https');
const {tmpdir} = require('node:os');
const {join} = require('node:path');

// Private HTTPS origins in the browser; forward only Littora requests to the two
// loopback test servers. No Google endpoint, screenshot, HAR or trace is used.
async function checkGoogleBrowser({origin, login, session, fixture, memberCookie}) {
  const tmp = mkdtempSync(join(tmpdir(),'littora-login-tls-'));
  let proxy, browser;
  try {
    execFileSync('openssl',['req','-new','-x509','-newkey','rsa:2048','-nodes','-days','1',
      '-subj','/CN=recette.invalid','-keyout','key.pem','-out','cert.pem'],{cwd:tmp,stdio:'ignore'});
    proxy = createServer({key:readFileSync(join(tmp,'key.pem')),cert:readFileSync(join(tmp,'cert.pem'))},async (req,res)=>{
      const url = new URL(req.url,'https://'+req.headers.host);
      if (url.origin === 'https://accounts.google.com' && url.pathname === '/o/oauth2/v2/auth') {
        if (req.headers.cookie || req.headers.referer) {res.writeHead(403);return res.end();}
        const cb = fixture.authorise(url);
        res.setHeader('Content-Type','text/html');
        return res.end('<a href="'+cb.href.replaceAll('&','&amp;')+'">Autoriser le test</a>');
      }
      if (url.origin !== origin) {res.writeHead(404);return res.end();}
      if (url.pathname === '/') {res.setHeader('Content-Type','text/html');return res.end('<h1>Recette</h1>');}
      const dst = url.pathname.startsWith('/connexion/google') ? login + url.pathname + url.search :
        url.pathname === '/api/member/session' ? session : null;
      if (!dst) {res.writeHead(404);return res.end();}
      const headers = {};
      for (const k of ['cookie','origin','sec-fetch-site','accept']) if (req.headers[k]) headers[k]=req.headers[k];
      try {
        const reply = await fetch(dst, {method:req.method,headers,redirect:'manual'});
        for (const [k,v] of reply.headers) if (!['set-cookie','connection','transfer-encoding','content-length'].includes(k)) res.setHeader(k,v);
        res.setHeader('Set-Cookie',reply.headers.getSetCookie());
        res.statusCode=reply.status; res.end(await reply.text());
      } catch { res.writeHead(502);res.end(); }
    });
    await new Promise((ok,fail)=>{proxy.once('error',fail);proxy.listen(0,'127.0.0.1',ok);});
    const target='127.0.0.1:'+proxy.address().port;
    browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || undefined,
      args:['--no-proxy-server','--disable-quic','--host-resolver-rules=MAP '+new URL(origin).hostname+' '+target+', MAP accounts.google.com '+target+', MAP * ~NOTFOUND']});
    const ctx = await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'});
    const page = await ctx.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(origin+'/connexion/google');
    const [start]=await Promise.all([page.waitForResponse(r=>r.url()===origin+'/connexion/google' && r.request().method()==='POST'),
      page.getByRole('button',{name:'Continuer avec Google'}).click()]);
    assert.equal(start.status(),303,'Same-origin form submission must be accepted');
    assert.equal(new URL(page.url()).origin,'https://accounts.google.com');
    await page.getByRole('link',{name:'Autoriser le test'}).click();
    await page.waitForURL(origin+'/');
    const resp = await page.evaluate(async () => {
      const r = await fetch('/api/member/session');
      return {status:r.status, privateCookieHidden:!document.cookie.includes('__Host-littora-member=')};
    });
    assert.deepEqual(resp,{status:200,privateCookieHidden:true});
    const cookies = await ctx.cookies(origin);
    const issued = cookies.find(c=>c.name===memberCookie);
    assert.ok(issued?.httpOnly && issued.secure && issued.sameSite==='Lax');
    assert.equal(cookies.some(c=>c.name==='__Host-littora-login'),false);
    await page.goto(origin+'/connexion/google');
    await page.getByRole('link',{name:'Mes données Littora'}).click();
    const [download]=await Promise.all([page.waitForEvent('download'),
      page.getByRole('button',{name:'Télécharger mes données'}).click()]);
    assert.equal(download.suggestedFilename(),'littora-mes-donnees.json');
    assert.equal(await download.failure(),null);
    await download.delete();
    await page.getByRole('button',{name:'Confirmer ma demande d’effacement'}).click();
    await page.getByRole('heading',{name:'Demande enregistrée'}).waitFor();
    await page.getByRole('link',{name:'Retour à Littora'}).click();
    assert.equal(await page.evaluate(async ()=>(await fetch('/api/member/session',{method:'DELETE'})).status),200);
    assert.equal(await page.evaluate(async ()=>(await fetch('/api/member/session')).status),401);
  } finally {
    await browser?.close();
    if (proxy?.listening) {proxy.closeAllConnections();await new Promise(ok=>proxy.close(ok));}
    rmSync(tmp,{force:true,recursive:true});
  }
}
module.exports = {checkGoogleBrowser};
