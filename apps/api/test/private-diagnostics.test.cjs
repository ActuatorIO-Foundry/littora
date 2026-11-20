const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {resolve} = require('node:path');

test('API and worker startup emit diagnostics without the original database exception', () => {
  const marker = 'private-' + randomUUID();
  for (const [entry,signal] of [['main','api_startup_failed'],['worker','worker_failure']]) {
    const result = spawnSync(process.execPath,['--require','./test/fixtures/database-ready.cjs','dist/'+entry+'.js'],{
      cwd:resolve(__dirname,'..'),encoding:'utf8',timeout:10000,
      env:{...process.env,NODE_ENV:'test',REDIS_URL:'',TEST_DB_FAILURE:'postgresql://private:'+marker+'@fixture.invalid/db'}
    });
    const output = result.stdout + result.stderr;
    assert.equal(result.status,1);
    assert.ok(output.includes(signal),'Missing startup diagnostic');
    assert.ok(!output.includes(marker),'Original database exception leaked');
  }
});

test('operator command errors do not echo input, paths or connection details', () => {
  const marker = 'private-' + randomUUID();
  for (const [script,args] of [['classify-water',['apply',marker]],['amenities',['apply','Test']],['ars',['status']],['catalogue-zone',['invalid',marker]]]) {
    const result = spawnSync(process.execPath,['scripts/'+script+'.cjs',...args],{cwd:resolve(__dirname,'..'),
      env:{...process.env,DATABASE_URL:'postgresql://test:'+marker+'@127.0.0.1:1/test'},encoding:'utf8',timeout:10000,input:marker});
    assert.equal(result.status,1);
    assert.ok(result.stderr.includes('failed'),'Missing operator diagnostic');
    assert.ok(!(result.stdout+result.stderr).includes(marker),'Operator diagnostic exposed input');
  }
});
