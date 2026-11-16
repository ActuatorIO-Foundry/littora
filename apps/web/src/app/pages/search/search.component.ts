import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { Subscription, timeout } from "rxjs";
import { Beach, BeachScore } from "../../models/beach.model";
import { LittoraApiService } from "../../services/littora-api.service";
import { IconComponent } from "../../shared/icon.component";
import { LoadingComponent } from "../../shared/loading.component";
import { CoastMapComponent } from "../../shared/coast-map.component";
import { COASTAL_ZONES, CoastalZone } from "../../shared/coastal-zones";
import { metricValue, providerLabel } from "../../shared/presentation";
type Result = Beach & {
  selectedScore?: number;
  scores?: BeachScore["scores"];
  flag?: string;
  waterTemp?: number;
};
@Component({
  selector: "app-search",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IconComponent,
    LoadingComponent,
    CoastMapComponent,
  ],
  templateUrl: "./search.component.html",
  styleUrl: "./search.component.css",
})
export class SearchComponent implements OnInit, OnDestroy {
  beaches: Result[] = [];
  selectedBeach: Beach | null = null;
  score: BeachScore | null = null;
  readonly coastalZones = COASTAL_ZONES;
  selectedZone: CoastalZone | null = null;
  selectedUsage = "bathing";
  query = "";
  waterType = "all";
  requiredFlag = "all";
  requireParking = false;
  requireToilets = false;
  requireLifeguard = false;
  minWaterTemp: number | null = null;
  maxWaterTemp: number | null = null;
  filtersOpen = false;
  mobileView: "list" | "map" = "list";
  sort = "name";
  resultLimit = 20;
  loading = true;
  loadingScore = false;
  locating = false;
  error = "";
  scoreError = "";
  message = "";
  readonly usages = [
    { id: "bathing", label: "Baignade", icon: "bathing" },
    { id: "family", label: "Famille", icon: "family" },
    { id: "paddle", label: "Sports nautiques", icon: "wind" },
    { id: "boat", label: "Bateau", icon: "boat" },
  ];
  readonly metricValue = metricValue;
  readonly providerLabel = providerLabel;
  private listRequest?: Subscription;
  private scoreRequest?: Subscription;
  private destroyed = false;
  constructor(
    private readonly api: LittoraApiService,
    private readonly cdr: ChangeDetectorRef,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}
  ngOnInit(): void {
    const p = this.route.snapshot.queryParamMap;
    this.query = p.get("q") ?? "";
    this.selectedUsage = this.usages.some((u) => u.id === p.get("usage"))
      ? p.get("usage")!
      : "bathing";
    this.waterType = ["sea", "river", "lake"].includes(p.get("water") ?? "")
      ? p.get("water")!
      : "all";
    this.requireParking = p.get("parking") === "1";
    this.requireToilets = p.get("toilets") === "1";
    this.requireLifeguard = p.get("rescue") === "1";
    this.requiredFlag = ["green", "yellow", "red"].includes(p.get("flag") ?? "")
      ? p.get("flag")!
      : "all";
    this.minWaterTemp =
      p.has("min") && Number.isFinite(Number(p.get("min")))
        ? Number(p.get("min"))
        : null;
    this.maxWaterTemp =
      p.has("max") && Number.isFinite(Number(p.get("max")))
        ? Number(p.get("max"))
        : null;
    const zone = this.coastalZones.find((z) => z.id === p.get("zone"));
    if (zone) this.exploreZone(zone);
    else this.loadBeaches();
  }
  loadBeaches(): void {
    this.listRequest?.unsubscribe();
    this.loading = true;
    this.error = "";
    this.listRequest = this.api
      .getBeaches()
      .pipe(timeout(20000))
      .subscribe({
        next: (r) => {
          this.beaches = r;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.error = "Les plages ne sont pas disponibles pour le moment.";
          this.cdr.markForCheck();
        },
      });
  }
  exploreZone(zone: CoastalZone): void {
    this.selectedZone = zone;
    this.loading = true;
    this.error = "";
    this.message = "";
    this.selectedBeach = null;
    this.score = null;
    this.beaches = [];
    this.listRequest?.unsubscribe();
    this.scoreRequest?.unsubscribe();
    this.syncFilters();
    this.listRequest = this.api
      .discoverBeaches(zone)
      .pipe(timeout(30000))
      .subscribe({
        next: (r) => {
          this.beaches = r.beaches;
          this.loading = false;
          this.message = r.warning
            ? "Source externe indisponible. Dernier catalogue disponible affiché."
            : "";
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.error = "Cette zone ne peut pas être chargée actuellement.";
          this.cdr.markForCheck();
        },
      });
  }
  chooseZone(id: string): void {
    const zone = this.coastalZones.find((z) => z.id === id);
    if (zone) this.exploreZone(zone);
    else {
      this.selectedZone = null;
      this.syncFilters();
      this.loadBeaches();
    }
  }
  useMyPosition(): void {
    if (!navigator.geolocation) {
      this.message = "La localisation est indisponible. Choisissez une façade.";
      return;
    }
    this.locating = true;
    this.message = "";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (this.destroyed) return;
        this.locating = false;
        this.loading = true;
        this.error = "";
        this.selectedZone = null;
        this.listRequest?.unsubscribe();
        this.syncFilters();
        this.listRequest = this.api
          .getRecommendations(
            pos.coords.latitude,
            pos.coords.longitude,
            this.selectedUsage,
          )
          .pipe(timeout(30000))
          .subscribe({
            next: (r) => {
              this.beaches = r;
              this.loading = false;
              this.message = "Plages à proximité de votre position.";
              this.cdr.markForCheck();
            },
            error: () => {
              this.loading = false;
              this.error = "Les plages à proximité ne sont pas disponibles.";
              this.cdr.markForCheck();
            },
          });
        this.cdr.markForCheck();
      },
      () => {
        if (this.destroyed) return;
        this.locating = false;
        this.message =
          "Position non disponible. Vous pouvez choisir une façade ou une ville.";
        this.cdr.markForCheck();
      },
      { timeout: 8000, maximumAge: 120000 },
    );
  }
  loadScore(beach: Beach): void {
    this.scoreRequest?.unsubscribe();
    this.selectedBeach = beach;
    this.score = null;
    this.loadingScore = true;
    this.scoreError = "";
    this.scoreRequest = this.api
      .getScore(beach.id)
      .pipe(timeout(25000))
      .subscribe({
        next: (r) => {
          this.score = r;
          this.loadingScore = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loadingScore = false;
          this.scoreError = "Conditions indisponibles pour cette plage.";
          this.cdr.markForCheck();
        },
      });
  }
  fromMap(beach: Beach): void {
    this.resultLimit = Math.max(
      this.resultLimit,
      this.displayedBeaches().findIndex((b) => b.id === beach.id) + 1,
    );
    this.mobileView = "list";
    this.loadScore(beach);
    setTimeout(() =>
      document.getElementById("beach-" + beach.id)?.scrollIntoView({
        block: "nearest",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      }),
    );
  }
  displayedBeaches(): Result[] {
    const q = this.query.trim().toLocaleLowerCase("fr");
    return this.beaches
      .filter((b) => {
        if (
          q &&
          !`${b.name} ${b.city} ${b.region}`.toLocaleLowerCase("fr").includes(q)
        )
          return false;
        if (this.waterType !== "all" && b.waterType !== this.waterType)
          return false;
        if (
          (this.requireParking && !b.has_parking) ||
          (this.requireToilets && !b.has_toilets) ||
          (this.requireLifeguard && !b.has_lifeguard)
        )
          return false;
        if (this.requiredFlag !== "all" && b.flag !== this.requiredFlag)
          return false;
        if (this.minWaterTemp !== null || this.maxWaterTemp !== null) {
          if (
            b.waterTemp === undefined ||
            b.waterTemp === null ||
            !Number.isFinite(b.waterTemp)
          )
            return false;
          if (this.minWaterTemp !== null && b.waterTemp < this.minWaterTemp)
            return false;
          if (this.maxWaterTemp !== null && b.waterTemp > this.maxWaterTemp)
            return false;
        }
        return true;
      })
      .sort((a, b) =>
        this.sort === "distance"
          ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
          : this.sort === "score"
            ? (this.scoreFor(b) ?? -1) - (this.scoreFor(a) ?? -1)
            : a.name.localeCompare(b.name, "fr"),
      );
  }
  scoreFor(b: Result): number | null {
    return (
      b.scores?.[this.selectedUsage as keyof BeachScore["scores"]] ??
      b.selectedScore ??
      null
    );
  }
  visibleBeaches(): Result[] {
    return this.displayedBeaches().slice(0, this.resultLimit);
  }
  resetFilters(): void {
    this.query = "";
    this.waterType = "all";
    this.requiredFlag = "all";
    this.requireParking = false;
    this.requireToilets = false;
    this.requireLifeguard = false;
    this.minWaterTemp = null;
    this.maxWaterTemp = null;
    this.syncFilters();
  }
  filterCount(): number {
    return (
      Number(this.waterType !== "all") +
      Number(this.requiredFlag !== "all") +
      Number(this.requireParking) +
      Number(this.requireToilets) +
      Number(this.requireLifeguard) +
      Number(this.minWaterTemp !== null || this.maxWaterTemp !== null)
    );
  }
  syncFilters(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: this.query || null,
        zone: this.selectedZone?.id ?? null,
        usage: this.selectedUsage,
        water: this.waterType === "all" ? null : this.waterType,
        parking: this.requireParking ? "1" : null,
        toilets: this.requireToilets ? "1" : null,
        rescue: this.requireLifeguard ? "1" : null,
        flag: this.requiredFlag === "all" ? null : this.requiredFlag,
        min: this.minWaterTemp,
        max: this.maxWaterTemp,
      },
      replaceUrl: true,
    });
  }
  get queryParams() {
    return this.route.snapshot.queryParams;
  }
  waterLabel(type?: string): string {
    return type === "river"
      ? "Rivière"
      : type === "lake"
        ? "Lac"
        : type === "sea"
          ? "Mer"
          : "Type à préciser";
  }
  trackByBeachId(_: number, b: Beach): string {
    return b.id;
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.listRequest?.unsubscribe();
    this.scoreRequest?.unsubscribe();
  }
}
