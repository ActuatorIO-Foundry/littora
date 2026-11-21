const assert = require('node:assert/strict');
const { test } = require('node:test');
const { dogAccess } = require('../dist/modules/beaches/dog-access');
const { schemaValidator } = require('../dist/http/contract');
const day = new Date('2026-11-22T11:00:00Z');
const validate = schemaValidator('DogAccess');

test('dog access: every published site has dated evidence; neighbours and similar names do not inherit rules', () => {
  const refs = { allowed: ['961374583'], conditional: ['30585237','197492653','167688426','291977817'],
    prohibited: ['161971394','77594385','166482963','138422227','166482964','138422434','208693407','227845072'] };
  for (const [status, ids] of Object.entries(refs)) for (const id of ids) {
    const result = dogAccess('way/' + id, day);
    assert.equal(validate(result), true);
    assert.equal(result.status, status);
    assert.match(result.sourceUrl, /^https:\/\//);
  }
  for (const site of [null, 'way/487779952', 'way/413745568', 'node/30585237', 'Dog Beach']) {
    assert.deepEqual(dogAccess(site, day), { status: 'unknown', reason: 'unlisted' });
  }
  assert.equal(validate({status:'allowed'}), false);
  assert.equal(validate({status:'unknown'}), false);
});

test('dog access: both seasonal boundaries use midnight in France, independent of host timezone', () => {
  for (const [time, status] of [
    ['2027-06-14T21:59:59Z', 'conditional'], ['2027-06-14T22:00:00Z', 'prohibited'],
    ['2027-09-15T21:59:59Z', 'prohibited'], ['2027-09-15T22:00:00Z', 'conditional'],
  ]) assert.equal(dogAccess('way/167688426', new Date(time)).status, status);
});

test('dog access: expired review, ended regulation, future evidence and conflicts never yield permission', () => {
  const base = { sites:['way/1'], status:'conditional', detail:'En laisse', source:'Gestionnaire',
    sourceUrl:'https://example.org/plage', checkedOn:'2026-11-01', reviewBy:'2027-11-01' };
  for (const entry of [{reviewBy:'2026-11-21'}, {validUntil:'2026-11-21'}, {checkedOn:'2026-11-23'}]) {
    assert.deepEqual(dogAccess('way/1', day, [{...base,...entry}]), {status:'unknown',reason:'outdated'});
  }
  assert.deepEqual(dogAccess('way/1', day, [base,{...base,status:'prohibited'}]), {status:'unknown',reason:'conflict'});
});
