// Preloaded only in the disposable worker subprocess. Never contact the internet in CI.
global.fetch = async input => {
  const url = new URL(input);
  if (url.hostname !== 'api.open-meteo.com') throw Error('unexpected provider');
  return Response.json({ hourly_units: { temperature_2m: '°C' }, hourly: {
    time: [Math.floor(Date.now()/1000)], temperature_2m: [17] } });
};
