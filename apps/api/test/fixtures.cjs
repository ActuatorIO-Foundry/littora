require('reflect-metadata');
const { ScoreService } = require('../dist/modules/score/score.service');

const beach = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Plage de test', city: 'Hyères', department: 'Var', region: 'Provence',
  coastline: 'Méditerranée', lat: 43.08, lon: 6.15,
  has_lifeguard: true, has_parking: true, has_toilets: true, osm_id: null,
  water_type: 'sea', waterType: 'sea',
};

function scoreFixture({ weather = {}, marine = {}, quality = 'good', reports = [], consensus = null } = {}) {
  return new ScoreService(
    { get: async () => ({ ...beach }) },
    { get: async () => ({ provider: 'test-weather', current: {
      temperature_2m: 24, wind_speed_10m: 8, wind_gusts_10m: 10, uv_index: 3,
    }, ...weather }) },
    { get: async () => ({ provider: 'test-marine', current: {
      sea_surface_temperature: 22, wave_height: 0.3, ocean_current_velocity: 0.05,
    }, ...marine }) },
    { get: async () => ({ provider: 'test-tides' }) },
    { get: async () => ({ provider: 'test-water', status: quality }) },
    { aggregate: async () => reports, flagConsensus: async () => consensus },
    { setJson: async () => true },
  );
}

module.exports = { beach, scoreFixture };
