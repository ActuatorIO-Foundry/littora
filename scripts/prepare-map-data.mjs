import { writeFile } from "node:fs/promises";

// Keep a small, self-hosted regional extract of the public-domain Natural Earth data.
const url =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";
const response = await fetch(url);
if (!response.ok) throw new Error(`Natural Earth: HTTP ${response.status}`);
const collection = await response.json();
const countries = new Set([
  "France",
  "Spain",
  "Portugal",
  "United Kingdom",
  "Ireland",
  "Belgium",
  "Netherlands",
  "Luxembourg",
  "Germany",
  "Switzerland",
  "Italy",
  "Austria",
]);
const features = collection.features
  .filter((f) => countries.has(f.properties.ADMIN))
  .map((f) => {
    const polygons =
      f.geometry.type === "MultiPolygon"
        ? f.geometry.coordinates
        : [f.geometry.coordinates];
    return {
      type: "Feature",
      properties: { name: f.properties.ADMIN },
      geometry: {
        type: "MultiPolygon",
        coordinates: polygons.filter((p) =>
          p[0].some(([x, y]) => x > -12 && x < 20 && y > 35 && y < 56),
        ),
      },
    };
  });
await writeFile(
  new URL("../apps/web/public/data/europe.geojson", import.meta.url),
  JSON.stringify({ type: "FeatureCollection", features }),
);
const coastResponse = await fetch(
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson",
);
if (!coastResponse.ok)
  throw new Error(`Coastline: HTTP ${coastResponse.status}`);
const coasts = await coastResponse.json();
const lines = [];
const frenchRings = features
  .find((f) => f.properties.name === "France")
  .geometry.coordinates.flat();
function nearFrenchLand(x, y) {
  return frenchRings.some((ring) =>
    ring.some(([a, b], index) => {
      const [c, d] = ring[(index + 1) % ring.length];
      if (
        x < Math.min(a, c) - 0.035 ||
        x > Math.max(a, c) + 0.035 ||
        y < Math.min(b, d) - 0.035 ||
        y > Math.max(b, d) + 0.035
      )
        return false;
      const dx = c - a,
        dy = d - b;
      const t = Math.max(
        0,
        Math.min(1, ((x - a) * dx + (y - b) * dy) / (dx * dx + dy * dy || 1)),
      );
      return Math.hypot(x - a - t * dx, y - b - t * dy) < 0.035;
    }),
  );
}
for (const feature of coasts.features) {
  const segments =
    feature.geometry.type === "MultiLineString"
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];
  for (const segment of segments) {
    let run = [];
    for (const [x, y] of segment) {
      if (x > -5.2 && x < 10 && y > 41.3 && y < 51.15 && nearFrenchLand(x, y))
        run.push([x, y]);
      else {
        if (run.length > 1) lines.push(run);
        run = [];
      }
    }
    if (run.length > 1) lines.push(run);
  }
}
await writeFile(
  new URL("../apps/web/public/data/coasts.geojson", import.meta.url),
  JSON.stringify({
    type: "Feature",
    properties: {},
    geometry: { type: "MultiLineString", coordinates: lines },
  }),
);
console.log(
  `Prepared ${features.length} countries and ${lines.length} coastline segments.`,
);
