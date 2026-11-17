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
    </p>
    <p class="map-error" *ngIf="!failed && shorelineFailed" role="status">
      Limite terre-mer indisponible. Le fond OpenStreetMap reste affiché.
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
  shorelineFailed = false;
  private L?: typeof Leaflet;
  private map?: Leaflet.Map;
  private markers?: Leaflet.LayerGroup;
  private coasts?: Leaflet.LayerGroup;
  private shoreline?: Leaflet.TileLayer.WMS;
  private selectedShoreline?: Leaflet.TileLayer.WMS;
  private configuration?: {
    tiles: string;
    tileAttribution: string;
    shoreline: string;
    shorelineLayer: string;
    shorelineAttribution: string;
  };
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
        this.map.createPane("fallback-map").style.zIndex = "150";
        this.map.createPane("shoreline").style.zIndex = "350";
        this.map.createPane("shoreline-selected").style.zIndex = "351";
        this.map.getPane("shoreline")!.style.pointerEvents = "none";
        this.map.getPane("shoreline-selected")!.style.pointerEvents = "none";
        this.map.on("move zoom resize", () => this.clipSelectedShoreline());
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
      const configResponse = await fetch("/data/map-config.json", {
        signal: this.abort.signal,
      });
      if (!configResponse.ok) throw new Error("Map configuration unavailable");
      this.configuration = await configResponse.json();
      if (this.destroyed) return;
      const config = this.configuration!;
      L.tileLayer(config.tiles, {
        attribution: config.tileAttribution,
        maxZoom: 19,
        updateWhenIdle: true,
        keepBuffer: 1,
        className: "basemap-tiles",
      })
        .on("tileerror", () => {
          this.failed = true;
          this.cdr.markForCheck();
        })
        .on("tileload", () => {
          this.failed = false;
          this.cdr.markForCheck();
        })
        .addTo(this.map!);
      if (!this.detail) {
        this.shoreline = this.createShoreline("shoreline", "shoreline-tiles");
        this.map!.attributionControl.addAttribution(
          config.shorelineAttribution,
        );
        // A low-detail land layer remains underneath the online tiles during an outage.
        const response = await fetch("/data/europe.geojson", {
          signal: this.abort.signal,
        });
        if (!response.ok) throw new Error("Map unavailable");
        const land = (await response.json()) as GeoJsonObject;
        if (this.destroyed) return;
        L.geoJSON(land, {
          pane: "fallback-map",
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
    if (!this.L || !this.coasts || this.detail || !this.configuration) return;
    if (this.renderedCoastZone === this.zoneId) return;
    this.renderedCoastZone = this.zoneId;
    const L = this.L;
    this.coasts.clearLayers();
    if (this.zoneId && !this.selectedShoreline) {
      this.selectedShoreline = this.createShoreline(
        "shoreline-selected",
        "shoreline-selected-tiles",
      );
    } else if (!this.zoneId && this.selectedShoreline) {
      this.selectedShoreline.remove();
      this.selectedShoreline = undefined;
    }
    this.clipSelectedShoreline();
    for (const zone of COASTAL_ZONES) {
      const chosen = zone.id === this.zoneId;
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
  private createShoreline(
    pane: string,
    className: string,
  ): Leaflet.TileLayer.WMS {
    const config = this.configuration!;
    return this.L!.tileLayer.wms(config.shoreline, {
      layers: config.shorelineLayer,
      format: "image/png",
      transparent: true,
      version: "1.1.1",
      pane,
      className,
      bounds: [
        [41.2, -5.4],
        [51.2, 10],
      ],
      updateWhenIdle: true,
      keepBuffer: 1,
    })
      .on("tileerror", () => {
        this.shorelineFailed = true;
        this.cdr.markForCheck();
      })
      .on("tileload", () => {
        this.shorelineFailed = false;
        this.cdr.markForCheck();
      })
      .addTo(this.map!);
  }
  private clipSelectedShoreline(): void {
    const zone = COASTAL_ZONES.find((z) => z.id === this.zoneId);
    if (!this.map || !zone) return;
    const [south, west, north, east] = zone.bbox.split(",").map(Number);
    const topLeft = this.map.latLngToLayerPoint([north, west]);
    const bottomRight = this.map.latLngToLayerPoint([south, east]);
    // Clip the raster, not the coastline vertices: no artificial gaps or straight joins.
    this.map.getPane("shoreline-selected")!.style.clipPath =
      `polygon(${topLeft.x}px ${topLeft.y}px, ${bottomRight.x}px ${topLeft.y}px, ${bottomRight.x}px ${bottomRight.y}px, ${topLeft.x}px ${bottomRight.y}px)`;
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
