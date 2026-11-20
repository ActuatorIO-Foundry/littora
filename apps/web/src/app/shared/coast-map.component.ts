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
  SimpleChanges,
  ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import type * as Leaflet from "leaflet";
import type { GeoJsonObject } from "geojson";
import { Beach, BeachAmenity } from "../models/beach.model";
import { Commune } from "../models/commune.model";
import { COASTAL_ZONES, CoastalZone } from "./coastal-zones";
import { IconComponent } from "./icon.component";
import { amenityGroups, MapPoints } from "./map-points";

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
          : inland ? 'Carte des sites de baignade en eau douce' : 'Carte des façades du littoral français'
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
    <details class="map-layers" *ngIf="detail && layers.length">
      <summary class="icon-button" aria-label="Équipements sur la carte" title="Équipements sur la carte">
        <app-icon name="filters" [size]="18" />
      </summary>
      <fieldset>
        <legend>Équipements sur la carte</legend>
        <label *ngFor="let layer of layers">
          <input type="checkbox" [checked]="!hidden.has(layer.category)" (change)="toggleLayer(layer.category)" />
          {{ layer.name }} ({{ layer.count }})
        </label>
      </fieldset>
    </details>
    <p class="map-error" *ngIf="failed" role="status">
      Fond de carte indisponible. La liste des plages reste accessible.
    </p>
    <p class="map-error" *ngIf="!inland && !failed && shorelineFailed" role="status">
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
      .map-layers { position:absolute; right:12px; top:56px; z-index:501; max-width:calc(100% - 24px); }
      .map-layers summary { width:36px; height:36px; list-style:none; margin-left:auto; cursor:pointer; }
      .map-layers summary::-webkit-details-marker { display:none; }
      .map-layers fieldset { background:white; margin:4px 0 0; padding:8px 12px; border:1px solid #c4d6d4; border-radius:6px; max-height:160px; overflow:auto; }
      .map-layers legend { float:left; width:100%; font-size:13px; font-weight:700; }
      .map-layers label { display:flex; align-items:center; gap:8px; min-height:30px; font-size:13px; }
    `,
  ],
})
export class CoastMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild("map", { static: true }) el!: ElementRef<HTMLDivElement>;
  @Input() beaches: Beach[] = [];
  @Input() selected: string | null = null;
  @Input() zoneId: string | null = null;
  @Input() detail = false;
  @Input() inland = false;
  @Input() amenities: BeachAmenity[] = [];
  @Input() commune: Commune | null = null;
  @Output() beachSelect = new EventEmitter<Beach>();
  @Output() zoneSelect = new EventEmitter<CoastalZone>();
  failed = false;
  shorelineFailed = false;
  private L?: typeof Leaflet;
  private map?: Leaflet.Map;
  private points?: MapPoints;
  layers: {category: BeachAmenity['category']; name: string; count: number}[] = [];
  readonly hidden = new Set<BeachAmenity['category']>();
  private detailBeachId?: string;
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
  private boundary?: Leaflet.GeoJSON;
  private lastCommune: string | null = null;
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
      await import("leaflet.markercluster");
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
        this.coasts = L.layerGroup().addTo(this.map);
        this.reset();
        let visible = this.el.nativeElement.clientWidth > 0 && this.el.nativeElement.clientHeight > 0;
        this.observer = new ResizeObserver(() => {
          if (
            !this.el.nativeElement.clientWidth ||
            !this.el.nativeElement.clientHeight
          ) {
            visible = false;
            return;
          }
          this.map?.invalidateSize({ pan: false });
          if (!visible) this.reset();
          visible = true;
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
    } catch (error) {
      if (!this.destroyed) {
        console.warn("[Littora] Map unavailable", error);
        this.failed = true;
        this.cdr.markForCheck();
      }
    } finally {
      if (!this.destroyed && this.L && this.map) {
        this.points = new MapPoints(this.L, this.map, this.detail);
        this.ngOnChanges();
      }
    }
  }
  toggleLayer(category: BeachAmenity['category']): void {
    if (this.hidden.has(category)) this.hidden.delete(category);
    else this.hidden.add(category);
    this.drawPoints();
  }
  private drawPoints(): void {
    this.points?.draw(this.beaches, this.amenities.filter(p => !this.hidden.has(p.category)), this.detail,
      beach => this.ngZone.run(() => this.beachSelect.emit(beach)));
    this.points?.highlight(this.selected, false);
  }
  ngOnChanges(changes?: SimpleChanges): void {
    const detailId = this.detail ? this.beaches[0]?.id : undefined;
    const detailChanged = detailId !== this.detailBeachId;
    if (detailChanged) this.hidden.clear();
    if (!changes || changes['amenities']) {
      this.layers = amenityGroups.map(g => ({...g, count:this.amenities.filter(p => p.category === g.category).length}))
        .filter(g => g.count > 0);
    }
    if (!this.map || !this.L || !this.points) return;
    const L = this.L;
    if (!changes || changes['beaches'] || changes['amenities']) this.drawPoints();
    if (changes?.['selected']) this.points.highlight(this.selected, !this.detail);
    this.drawCoasts();
    const communeCode = this.commune?.code ?? null;
    if (communeCode !== this.lastCommune) {
      this.boundary?.remove();
      this.boundary = undefined;
      if (this.commune?.contour) {
        const label = document.createElement("span");
        label.textContent = this.commune.name;
        this.boundary = L.geoJSON(this.commune.contour, {
          style: {
            color: "#007e88",
            weight: 2,
            fillColor: "#007e88",
            fillOpacity: 0.08,
            className: "commune-boundary",
          },
          interactive: false,
        })
          .bindTooltip(label, { sticky: true })
          .addTo(this.map);
        this.boundary.bringToBack();
      }
      this.lastCommune = communeCode;
      this.reset();
    }
    if (this.commune) return;
    this.detailBeachId = detailId;
    if (detailChanged && this.beaches[0])
      this.map.setView([this.beaches[0].lat, this.beaches[0].lon], 14, {
        animate: false,
      });
    else if (this.zoneId !== this.lastZone || changes?.['inland'] ||
      (this.inland && (!changes || (changes['beaches'] && this.beaches.length)))) {
      this.reset();
      this.lastZone = this.zoneId;
    }
  }
  private drawCoasts(): void {
    if (!this.L || !this.coasts || this.detail || !this.configuration) return;
    if(this.inland){
      if(this.shoreline) this.map?.attributionControl.removeAttribution(this.configuration.shorelineAttribution);
      this.shoreline?.remove(); this.shoreline=undefined;
      this.selectedShoreline?.remove(); this.selectedShoreline=undefined;
      this.renderedCoastZone=undefined;
      this.coasts.clearLayers();
      return;
    }
    if(!this.shoreline){
      this.shoreline=this.createShoreline("shoreline","shoreline-tiles");
      this.map?.attributionControl.addAttribution(this.configuration.shorelineAttribution);
    }
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
    const zone = COASTAL_ZONES.find((z) => z.id === this.zoneId);
    if (this.commune && this.boundary) {
      this.map?.fitBounds(this.boundary.getBounds(), {
        padding: [25, 25],
        maxZoom: 14,
        animate: false,
      });
    } else if (this.detail && this.beaches[0])
      this.map?.setView([this.beaches[0].lat, this.beaches[0].lon], 14);
    else if(this.inland && this.beaches.length)
      this.map?.fitBounds(this.beaches.map(b=>[b.lat,b.lon] as [number,number]),{padding:[30,30],maxZoom:14,animate:false});
    else if (zone && !this.detail) {
      const [s, w, n, e] = zone.bbox.split(",").map(Number);
      this.map?.fitBounds([[s,w],[n,e]], {padding:[35,35], maxZoom:8, animate:false});
    } else
      this.map?.fitBounds(
        [
          [41.1, -5.5],
          [51.3, 10],
        ],
        { padding: [20, 20], animate: false },
      );
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.abort.abort();
    this.observer?.disconnect();
    this.map?.remove();
  }
}
