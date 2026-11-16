import {
  AfterViewInit,
  Component,
  ChangeDetectorRef,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import type * as Leaflet from "leaflet";
import type { GeoJsonObject } from "geojson";
import { Beach, BeachAmenity } from "../models/beach.model";
import { COASTAL_ZONES, CoastalZone } from "./coastal-zones";
import { IconComponent } from "./icon.component";

@Component({
  selector: "app-coast-map",
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: ` <div
      #map
      class="map-canvas"
      role="region"
      [attr.aria-label]="
        detail
          ? 'Carte de la plage et de ses équipements'
          : 'Carte des façades du littoral français'
      "
    ></div>
    <button
      class="icon-button reset-map"
      (click)="reset()"
      aria-label="Recentrer la carte"
      data-tooltip="Recentrer"
    >
      <app-icon name="locate" [size]="18" />
    </button>
    <p class="map-error" *ngIf="failed" role="status">
      Fond de carte indisponible. La liste des plages reste accessible.
    </p>`,
  styles: [
    `
      :host {
        display: block;
        position: relative;
        isolation: isolate;
        min-height: 320px;
        background: #d8edef;
      }
      .map-canvas {
        height: 100%;
        width: 100%;
        min-height: inherit;
      }
      .reset-map {
        position: absolute;
        z-index: 500;
        right: 12px;
        top: 12px;
        width: 36px;
        height: 36px;
      }
      .map-error {
        position: absolute;
        bottom: 30px;
        left: 12px;
        right: 12px;
        background: white;
        padding: 10px;
        font-size: 12px;
        z-index: 500;
      }
    `,
  ],
})
export class CoastMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild("map", { static: true }) el!: ElementRef<HTMLDivElement>;
  @Input() beaches: Beach[] = [];
  @Input() selected: string | null = null;
  @Input() zoneId: string | null = null;
  @Input() detail = false;
  @Input() amenities: BeachAmenity[] = [];
  @Output() beachSelect = new EventEmitter<Beach>();
  @Output() zoneSelect = new EventEmitter<CoastalZone>();
  failed = false;
  private L?: typeof Leaflet;
  private map?: Leaflet.Map;
  private markers?: Leaflet.LayerGroup;
  private coasts?: Leaflet.LayerGroup;
  private lines: number[][][] = [];
  private observer?: ResizeObserver;
  private destroyed = false;
  private lastZone: string | null = null;
  private renderedCoastZone: string | null | undefined;
  private readonly abort = new AbortController();
  constructor(
    private readonly ngZone: NgZone,
    private readonly cdr: ChangeDetectorRef,
  ) {}
  async ngAfterViewInit(): Promise<void> {
    try {
      const module = await import("leaflet");
      const L =
        (module as unknown as { default?: typeof Leaflet }).default ?? module;
      if (this.destroyed) return;
      this.L = L;
      this.ngZone.runOutsideAngular(() => {
        this.map = L.map(this.el.nativeElement, {
          scrollWheelZoom: false,
          zoomControl: true,
          minZoom: this.detail ? 5 : 4,
          maxZoom: 18,
        });
        this.markers = L.layerGroup().addTo(this.map);
        this.coasts = L.layerGroup().addTo(this.map);
        this.reset();
        this.observer = new ResizeObserver(() => {
          if (
            !this.el.nativeElement.clientWidth ||
            !this.el.nativeElement.clientHeight
          )
            return;
          this.map?.invalidateSize({ pan: false });
          this.fitCurrent();
        });
        this.observer.observe(this.el.nativeElement);
      });
      if (this.detail) {
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        })
          .on("tileerror", () => {
            this.failed = true;
            this.cdr.markForCheck();
          })
          .on("tileload", () => {
            if (this.failed) {
              this.failed = false;
              this.cdr.markForCheck();
            }
          })
          .addTo(this.map!);
      } else {
        const response = await fetch("/data/europe.geojson", {
          signal: this.abort.signal,
        });
        if (!response.ok) throw new Error("Map unavailable");
        const land = (await response.json()) as GeoJsonObject;
        if (this.destroyed) return;
        L.geoJSON(land, {
          interactive: false,
          style: () => ({
            color: "#bdccca",
            weight: 1,
            fillColor: "#fafbf8",
            fillOpacity: 1,
          }),
        })
          .addTo(this.map!)
          .bringToBack();
        this.map!.attributionControl.addAttribution(
          '<a href="https://www.naturalearthdata.com/">Natural Earth</a>',
        );
        for (const [label, lat, lon] of [
          ["Paris", 48.86, 2.35],
          ["Bordeaux", 44.84, -0.58],
          ["Lyon", 45.76, 4.84],
          ["Marseille", 43.29, 5.37],
          ["Nantes", 47.22, -1.55],
        ] as [string, number, number][]) {
          L.circleMarker([lat, lon], {
            radius: 2,
            color: "#61767a",
            weight: 0,
            fillOpacity: 1,
          })
            .bindTooltip(label, {
              permanent: true,
              direction: "right",
              className: "map-label",
              offset: [4, 0],
            })
            .addTo(this.map!);
        }
        const coastResponse = await fetch("/data/coasts.geojson", {
          signal: this.abort.signal,
        });
        if (!coastResponse.ok) throw new Error("Coasts unavailable");
        this.lines = (await coastResponse.json()).geometry.coordinates;
        if (this.destroyed) return;
      }
      this.ngOnChanges();
    } catch (error) {
      if (!this.destroyed) {
        console.warn("[Littora] Map unavailable", error);
        this.failed = true;
        this.cdr.markForCheck();
      }
    }
  }
  ngOnChanges(): void {
    if (!this.map || !this.L || !this.markers) return;
    const L = this.L;
    this.markers.clearLayers();
    for (const beach of this.beaches) {
      if (
        !Number.isFinite(Number(beach.lat)) ||
        !Number.isFinite(Number(beach.lon))
      )
        continue;
      const active = beach.id === this.selected;
      const label = document.createElement("span");
      label.textContent = beach.name;
      L.circleMarker([Number(beach.lat), Number(beach.lon)], {
        radius: active ? 8 : 5,
        color: "white",
        weight: 2,
        fillColor: active ? "#d94d3b" : "#007e88",
        fillOpacity: 1,
      })
        .bindTooltip(label)
        .on("click", () => this.ngZone.run(() => this.beachSelect.emit(beach)))
        .addTo(this.markers);
    }
    for (const poi of this.amenities.filter(
      (p) => p.source !== "local-hint" && p.verification !== "to_verify",
    )) {
      const label = document.createElement("span");
      label.textContent = poi.name;
      L.circleMarker([poi.lat, poi.lon], {
        radius: 5,
        color: "white",
        weight: 2,
        fillColor: "#98620a",
        fillOpacity: 1,
      })
        .bindTooltip(label)
        .addTo(this.markers);
    }
    this.drawCoasts();
    if (this.detail && this.beaches[0])
      this.map.setView([this.beaches[0].lat, this.beaches[0].lon], 14, {
        animate: false,
      });
    else if (this.zoneId !== this.lastZone) {
      const zone = COASTAL_ZONES.find((z) => z.id === this.zoneId);
      if (zone) {
        const [s, w, n, e] = zone.bbox.split(",").map(Number);
        this.map.fitBounds(
          [
            [s, w],
            [n, e],
          ],
          {
            padding: [35, 35],
            maxZoom: 8,
            animate: !matchMedia("(prefers-reduced-motion: reduce)").matches,
          },
        );
      } else this.reset();
      this.lastZone = this.zoneId;
    }
  }
  private drawCoasts(): void {
    if (!this.L || !this.coasts || this.detail || !this.lines.length) return;
    if (this.renderedCoastZone === this.zoneId) return;
    this.renderedCoastZone = this.zoneId;
    const L = this.L;
    this.coasts.clearLayers();
    for (const zone of COASTAL_ZONES) {
      const [s, w, n, e] = zone.bbox.split(",").map(Number);
      const chosen = zone.id === this.zoneId;
      const runs: Leaflet.LatLngExpression[][] = [];
      for (const line of this.lines) {
        let run: Leaflet.LatLngExpression[] = [];
        for (const [x, y] of line) {
          if (x >= w && x <= e && y >= s && y <= n) run.push([y, x]);
          else {
            if (run.length > 1) runs.push(run);
            run = [];
          }
        }
        if (run.length > 1) runs.push(run);
      }
      const coast = L.polyline(runs, {
        color: chosen ? "#d94d3b" : "#058b96",
        weight: chosen ? 5 : 2.5,
        opacity: chosen ? 1 : 0.75,
      }).addTo(this.coasts);
      coast.on("click", () =>
        this.ngZone.run(() => this.zoneSelect.emit(zone)),
      );
      L.circleMarker([zone.center.lat, zone.center.lon], {
        radius: 2,
        opacity: 0,
        fillOpacity: 0,
      })
        .bindTooltip(
          zone.id === "azur"
            ? "Côte d’Azur"
            : zone.id === "manche"
              ? "Manche & Opale"
              : zone.name,
          {
            permanent: true,
            direction:
              zone.id === "occitanie" || zone.id === "bretagne"
                ? "left"
                : zone.id === "azur"
                  ? "right"
                  : "center",
            interactive: true,
            className: `zone-marker ${chosen ? "selected" : ""}`,
          },
        )
        .on("click", () => this.ngZone.run(() => this.zoneSelect.emit(zone)))
        .addTo(this.coasts);
    }
  }
  reset(): void {
    if (this.detail && this.beaches[0])
      this.map?.setView([this.beaches[0].lat, this.beaches[0].lon], 14);
    else
      this.map?.fitBounds(
        [
          [41.1, -5.5],
          [51.3, 10],
        ],
        { padding: [20, 20], animate: false },
      );
  }
  private fitCurrent(): void {
    const zone = COASTAL_ZONES.find((z) => z.id === this.zoneId);
    if (!this.detail && zone) {
      const [s, w, n, e] = zone.bbox.split(",").map(Number);
      this.map?.fitBounds(
        [
          [s, w],
          [n, e],
        ],
        { padding: [35, 35], maxZoom: 8, animate: false },
      );
    } else this.reset();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.abort.abort();
    this.observer?.disconnect();
    this.map?.remove();
  }
}
