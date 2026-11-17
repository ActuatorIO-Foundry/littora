const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

function metropolitanGeometry(records) {
  assert.equal(records.length, 1, 'Expected exactly one country');
  const country = records[0];
  assert.equal(country.osm_type, 'relation');
  assert.equal(country.osm_id, 2202162, 'Expected France administrative relation');
  assert.equal(country.type, 'administrative');
  assert.equal(country.geojson.type, 'MultiPolygon');
  const coordinates = country.geojson.coordinates.filter(polygon => {
    const points = polygon.flat();
    assert.ok(points.length >= 4 && points.every(p => p.length === 2 && p.every(Number.isFinite)));
    const inside = points.map(([x,y]) => x >= -6 && x <= 10 && y >= 41 && y <= 52);
    assert.ok(inside.every(Boolean) || inside.every(x => !x), 'Component crosses the metropolitan extraction envelope');
    return inside.every(Boolean);
  });
  assert.equal(coordinates.length, 2, 'Expected continental and Corsican components, including coastal waters');
  return { type: 'MultiPolygon', coordinates };
}

function generate(raw) {
  const geometry = metropolitanGeometry(JSON.parse(raw));
  return readFileSync(resolve(__dirname, '../reference/metropolitan-territory.sql.in'), 'utf8')
    .replace('@SOURCE_SHA256@', createHash('sha256').update(raw).digest('hex'))
    .replace('@GEOMETRY@', JSON.stringify(geometry));
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  assert.ok(input && output, 'Usage: prepare-territory.cjs NOMINATIM_SNAPSHOT OUTPUT.sql');
  // Never overwrite an immutable migration or an existing reference snapshot.
  writeFileSync(output, generate(readFileSync(input, 'utf8')), { flag: 'wx' });
}
module.exports = { metropolitanGeometry, generate };
