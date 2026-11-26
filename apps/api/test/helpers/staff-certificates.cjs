const {execFileSync}=require('node:child_process');
const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');

exports.testCertificates=function(dir,withReplacement=false){
  const ssl=(...args)=>execFileSync('openssl',args,{cwd:dir,stdio:'ignore'});
  const read=file=>readFileSync(join(dir,file));
  ssl('req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=Inbox Test CA','-out','ca.pem','-keyout','ca.key');
  function leaf(name,usage){
    ssl('req','-new','-newkey','rsa:2048','-nodes','-subj','/CN='+name,'-out',name+'.csr','-keyout',name+'.key');
    writeFileSync(join(dir,'leaf.ext'),'basicConstraints=CA:FALSE\nsubjectAltName=DNS:localhost\nextendedKeyUsage='+usage+'\n');
    ssl('x509','-req','-in',name+'.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-days','1','-extfile','leaf.ext','-out',name+'.pem');
    return {cert:read(name+'.pem'),key:read(name+'.key')};
  }
  return {ca:read('ca.pem'),server:leaf('localhost','serverAuth'),manager:leaf('manager','clientAuth'),member:leaf('member','clientAuth'),
    ...(withReplacement?{replacement:leaf('replacement','clientAuth')}:{})};
};
