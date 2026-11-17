import { writeFile } from "node:fs/promises";

// Low-detail offline fallback only; the interactive coastline uses Shom-IGN WMS.
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
console.log(`Prepared ${features.length} countries for the offline fallback.`);
