import type { MultiPolygon, Polygon } from "geojson";
import { Beach } from "./beach.model";

export interface Commune {
  code: string;
  name: string;
  department: { code: string; name: string };
  region: { code: string; name: string };
  center: { lat: number; lon: number };
  bbox: [number, number, number, number];
  contour?: Polygon | MultiPolygon;
}
export interface CommuneCatalogue {
  commune: Commune;
  beaches: Beach[];
  source: string;
  collectedAt: string | null;
  coverage: "partial";
  capped: boolean;
  warning?: string;
}
