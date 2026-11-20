// Preloaded only in the disposable worker subprocess. Never contact the internet in CI.
global.fetch = async input => {
  const url = new URL(input);
  if (url.origin==='https://services.data.shom.fr' && url.pathname==='/INSPIRE/wfs') {
    const sample=require('./shom-calais.json');
    if (!url.searchParams.has('resourceId')) return Response.json(sample.vmax);
    const port=require('../../dist/modules/tides/shom-ports').ports.find(p=>p.ramId===url.searchParams.get('resourceId'));
    const ram=structuredClone(sample.ram);
    Object.assign(ram.features[0],{id:port.ramId,geometry:{type:'Point',coordinates:[port.lon,port.lat]}});
    ram.features[0].properties.site=port.name;
    return Response.json(ram);
  }
  if (url.hostname !== 'api.open-meteo.com') throw Error('unexpected provider');
  if (process.env.TEST_FORECAST_QUOTA === '1') return new Response(null, {status:429,headers:{'retry-after':'900'}});
  return Response.json({ hourly_units: { temperature_2m: '°C' }, hourly: {
    time: [Math.floor(Date.now()/1000)], temperature_2m: [17] } });
};
