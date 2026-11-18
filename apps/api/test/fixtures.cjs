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
  const date=new Date(Date.now()).toISOString();
  const source={status:'available',kind:'forecast',fetchedAt:date,validAt:date};
  return new ScoreService(
    { get: async () => ({ ...beach }) },
    { get: async () => ({ ...source, units:{temperature_2m:'°C',wind_speed_10m:'km/h',wind_gusts_10m:'km/h',uv_index:''},provider: 'test-weather', current: {
      temperature_2m: 24, wind_speed_10m: 8, wind_gusts_10m: 10, uv_index: 3,
    }, ...weather }) },
    { get: async () => ({ ...source, units:{wave_height:'m',ocean_current_velocity:'m/s',sea_surface_temperature:'°C'},provider: 'test-marine', current: {
      sea_surface_temperature: 22, wave_height: 0.3, ocean_current_velocity: 0.05,
    }, ...marine }) },
    { get: async () => ({ provider: 'test-tides' }) },
    { get: async () => ({ provider: 'test-water', status: quality }) },
    { aggregate: async () => reports, flagConsensus: async () => consensus },
    { setJson: async () => true },
  );
}

function calmProjection(water=21) {
  const date=new Date(Date.now()).toISOString();
  const source={kind:'forecast',status:'available',fetchedAt:date,validAt:date};
  return {lat:43,lon:6,waterType:'sea',calculatedAt:date,
    weather:{temperature_2m:0,wind_speed_10m:0,wind_gusts_10m:0,uv_index:0},
    marine:{wave_height:0,ocean_current_velocity:0,sea_surface_temperature:water},community:[],quality:'unknown',
    dataStatus:{weather:{...source,units:{temperature_2m:'°C',wind_speed_10m:'km/h',wind_gusts_10m:'km/h',uv_index:''}},
      marine:{...source,units:{wave_height:'m',ocean_current_velocity:'m/s',sea_surface_temperature:'°C'}}}};
}

module.exports = { beach, scoreFixture, calmProjection };
