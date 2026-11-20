import type * as Leaflet from "leaflet";
import type { Beach, BeachAmenity } from "../models/beach.model";

export const amenityGroups = [
  { category: "parking", name: "Stationnement", icon: "parking" },
  { category: "toilets", name: "Toilettes", icon: "toilets" },
  { category: "rescue", name: "Poste de secours", icon: "rescue" },
  { category: "rental", name: "Locations nautiques", icon: "boat" },
  { category: "food", name: "Restauration", icon: "compass" },
  { category: "other", name: "Autres équipements", icon: "pin" },
] as const;

function mappable(p: { lat: number; lon: number }): boolean {
  return (
    Number.isFinite(p.lat) &&
    Math.abs(p.lat) <= 90 &&
    Number.isFinite(p.lon) &&
    Math.abs(p.lon) <= 180
  );
}

export function listedAmenities(points: BeachAmenity[]) {
  const seen = new Set<string>();
  const places = new Map<string, BeachAmenity>();
  for (const p of points) {
    if (!p.id || !p.source || p.source === "local-hint" || p.verification === "to_verify" || !mappable(p)) continue;
    const identity = JSON.stringify([p.source, p.id]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    // Same label alone is not evidence: nearby car parks and shops may be distinct.
    const key = JSON.stringify([p.source, p.category, p.name.normalize('NFC').trim().toLocaleLowerCase('fr'), p.lat, p.lon]);
    const place = places.get(key);
    if (place) place.referenceCount = (place.referenceCount ?? 1) + 1;
    else places.set(key, {...p, referenceCount: 1});
  }
  return [...places.values()];
}

export function directionsTo(p: BeachAmenity): string {
  const params = new URLSearchParams({api:'1', destination:p.lat+','+p.lon});
  return 'https://www.google.com/maps/dir/?'+params;
}

function label(value: string) {
  const span = document.createElement("span");
  span.textContent = value;
  return span;
}

export class MapPoints {
  private readonly clusters: Leaflet.MarkerClusterGroup;
  private readonly beachMarkers = new Map<string, Leaflet.Marker>();
  private readonly anchors: Leaflet.LayerGroup;
  private selected: string | null = null;

  constructor(
    private readonly L: typeof Leaflet,
    map: Leaflet.Map,
    detail: boolean,
  ) {
    this.anchors = L.layerGroup().addTo(map);
    this.clusters = L.markerClusterGroup({
      maxClusterRadius: 34,
      showCoverageOnHover: false,
      animate: false,
      iconCreateFunction: (c) => {
        const count = c.getChildCount();
        const name = count + (detail ? " équipements" : " plages");
        const text = label(String(count));
        text.setAttribute("aria-hidden", "true");
        const description = label(name);
        description.className = "sr-only";
        const content = document.createElement("span");
        content.append(text, description);
        return L.divIcon({
          className: "map-point-cluster",
          html: content,
          iconSize: [32, 32],
        });
      },
    }).addTo(map);
  }

  private icon(kind: string) {
    return this.L.divIcon({
      className: "map-point " + kind,
      iconSize: [24, 24],
    });
  }

  draw(
    beaches: Beach[],
    amenities: BeachAmenity[],
    detail: boolean,
    select: (b: Beach) => void,
  ) {
    this.clusters.clearLayers();
    this.anchors.clearLayers();
    this.beachMarkers.clear();
    this.selected = null;
    const clustered: Leaflet.Marker[] = [];
    for (const b of beaches.filter(mappable)) {
      const marker = this.L.marker([b.lat, b.lon], {
        icon: this.icon("beach"),
        title: "Plage : " + b.name,
      }).bindTooltip(label(b.name));
      this.beachMarkers.set(b.id, marker);
      if (detail) marker.bindPopup(label(b.name)).addTo(this.anchors);
      else {
        marker
          .on("click", () => select(b))
          .on("keydown", (event) => {
            if (!["Enter", " "].includes(event.originalEvent.key)) return;
            this.L.DomEvent.stop(event.originalEvent);
            select(b);
          });
        clustered.push(marker);
      }
    }
    for (const p of amenities) {
      const group = amenityGroups.find((g) => g.category === p.category);
      const source = p.source === "openstreetmap" ? "OpenStreetMap" : p.source;
      const popup = document.createElement("div");
      const title = document.createElement("a");
      title.textContent = p.name;
      title.href = directionsTo(p);
      title.target = '_blank';
      title.rel = 'noopener noreferrer';
      title.title = 'Itinéraire dans Google Maps';
      popup.append(
        title,
        document.createElement("br"),
        label((group?.name ?? "Équipement") + " · " + source),
      );
      clustered.push(
        this.L.marker([p.lat, p.lon], {
          icon: this.icon("poi"),
          title: "Équipement : " + p.name,
        })
          .bindTooltip(label(p.name))
          .bindPopup(popup),
      );
    }
    this.clusters.addLayers(clustered);
  }

  highlight(id: string | null, reveal: boolean) {
    if (id === this.selected) return;
    if (this.selected)
      this.beachMarkers.get(this.selected)?.setIcon(this.icon("beach"));
    this.selected = id;
    const marker = id ? this.beachMarkers.get(id) : undefined;
    if (!marker) return;
    marker.setIcon(this.icon("beach active"));
    if (reveal && this.clusters.hasLayer(marker))
      this.clusters.zoomToShowLayer(marker, () => {});
  }
}
