export interface CoastalZone {
  id: string;
  name: string;
  coastline: string;
  bbox: string;
  center: { lat: number; lon: number };
}
export const COASTAL_ZONES: CoastalZone[] = [
  {
    id: "manche",
    name: "Manche & Opale",
    coastline: "Manche",
    bbox: "48.65,-2,51.1,2.55",
    center: { lat: 49.7, lon: -0.7 },
  },
  {
    id: "bretagne",
    name: "Bretagne",
    coastline: "Atlantique",
    bbox: "47.2,-5.2,48.9,-1.1",
    center: { lat: 48.2, lon: -3.4 },
  },
  {
    id: "atlantique",
    name: "Atlantique",
    coastline: "Atlantique",
    bbox: "43.3,-2,47.3,-.6",
    center: { lat: 45.5, lon: -1.25 },
  },
  {
    id: "occitanie",
    name: "Golfe du Lion",
    coastline: "Méditerranée",
    bbox: "42.3,2.7,43.8,4.6",
    center: { lat: 43.1, lon: 3.4 },
  },
  {
    id: "azur",
    name: "Provence & Côte d’Azur",
    coastline: "Méditerranée",
    bbox: "42.9,4.6,43.9,7.65",
    center: { lat: 43.35, lon: 6.2 },
  },
  {
    id: "corse",
    name: "Corse",
    coastline: "Méditerranée",
    bbox: "41.3,8.5,43.1,9.7",
    center: { lat: 42.1, lon: 9.1 },
  },
];
