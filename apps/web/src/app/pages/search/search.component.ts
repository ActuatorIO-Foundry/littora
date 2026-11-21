import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, ParamMap, Params, Router, RouterLink } from "@angular/router";
import { Subscription, timeout } from "rxjs";
import type { BeachSearch } from '@littora/api-client/models';
import { Beach, BeachScore } from "../../models/beach.model";
import { Commune } from "../../models/commune.model";
import { LittoraApiService } from "../../services/littora-api.service";
import { IconComponent } from "../../shared/icon.component";
import { ComfortExplanationComponent } from '../../shared/comfort-explanation.component';
import { DogAccessComponent } from '../../shared/dog-access.component';
import { LoadingComponent } from "../../shared/loading.component";
import { CoastMapComponent } from "../../shared/coast-map.component";
import { COASTAL_ZONES, CoastalZone } from "../../shared/coastal-zones";
import { metricValue, providerLabel, dataStatusLabel } from "../../shared/presentation";
type Result = Beach & {
  selectedScore?: number | null;
  scoreExplanation?: import('@littora/api-client/models').ScoreExplanation;
  scores?: BeachScore["scores"];
  flag?: string | null;
  bathingRestriction?: 'closed' | 'unknown';
  waterTemp?: number | null;
};
@Component({
  selector: "app-search",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IconComponent,
    ComfortExplanationComponent,
    DogAccessComponent,
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
  selectedCommune: Commune | null = null;
  communeSuggestions: Commune[] = [];
  activeSuggestion = -1;
  selectedUsage = "bathing";
  query = "";
  waterType = "all";
  readonly sections = [{id:'all',label:'Tous'}, {id:'sea',label:'Mer'}, {id:'lake',label:'Lacs'}, {id:'river',label:'Rivières'}];
  private sectionQueries = new Map<string,Params>();
  get inland() { return this.waterType === 'lake' || this.waterType === 'river'; }
  rememberSection() {
    // A private geolocation is specific to its history entry, not to a saved section.
    const {near, ...params}=this.route.snapshot.queryParams;
    this.sectionQueries.set(this.waterType,params);
  }
  sectionParams(id:string): Params {
    if(id===this.waterType) return this.route.snapshot.queryParams;
    const params:Params = {...(this.sectionQueries.get(id) ?? this.route.snapshot.queryParams), water:id==='all'?null:id};
    if(id==='lake'||id==='river') return {...params,zone:null,min:null,max:null,usage:null,
      sort:params['sort']==='score'?null:params['sort']};
    return params;
  }
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
  initialLoad = true;
  loadingScore = false;
  locating = false;
  error = "";
  scoreError = "";
  message = "";
  readonly usages = [
    { id: "bathing", label: "Baignade", icon: "bathing" },
    { id: "family", label: "Famille", icon: "family" },
    { id: "paddle", label: "Paddle", icon: "wind" },
    { id: "boat", label: "Bateau", icon: "boat" },
  ];
  readonly metricValue = metricValue;
  readonly providerLabel = providerLabel;
  readonly dataStatusLabel = dataStatusLabel;
  private listRequest?: Subscription;
  private scoreRequest?: Subscription;
  private placeRequest?: Subscription;
  private placeTimer?: ReturnType<typeof setTimeout>;
  private communePending = false;
  private communeCode: string | null = null;
  private destroyed = false;
  private routeRequest?: Subscription;
  private writtenParams = "";
  private locationAttempt = 0;
  private nearbyPosition: { lat: number; lon: number } | null = null;
  constructor(
    private readonly api: LittoraApiService,
    private readonly cdr: ChangeDetectorRef,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}
  ngOnInit(): void {
    this.routeRequest = this.route.queryParamMap.subscribe((p) => {
      const key = this.paramsKey(Object.fromEntries(p.keys.map((k) => [k, p.get(k)])));
      if (key === this.writtenParams) return;
      this.writtenParams = key;
      this.restoreSearch(p);
    });
  }
  private restoreSearch(p: ParamMap): void {
    this.cancelLocation();
    this.listRequest?.unsubscribe();
    this.placeRequest?.unsubscribe();
    clearTimeout(this.placeTimer);
    this.clearPreview();
    this.selectedZone = null;
    this.selectedCommune = null;
    this.communeCode = null;
    this.nearbyPosition = null;
    this.communePending = false;
    this.communeSuggestions = [];
    this.activeSuggestion = -1;
    this.message = "";
    this.query = p.get("q") ?? "";
    this.sort = ["name", "score", "distance"].includes(p.get("sort") ?? "") ? p.get("sort")! : "name";
    this.selectedUsage = this.usages.some((u) => u.id === p.get("usage"))
      ? p.get("usage")!
      : "bathing";
    this.waterType = ["sea", "river", "lake"].includes(p.get("water") ?? "")
      ? p.get("water")!
      : "all";
    if(this.inland && (['zone','min','max','usage'].some(k=>p.has(k)) || p.get('sort')==='score')){
      void this.router.navigate([], {relativeTo:this.route,queryParamsHandling:'merge',
        queryParams:{zone:null,min:null,max:null,usage:null,sort:p.get('sort')==='score'?null:p.get('sort')},
        state:this.router.getCurrentNavigation()?.extras.state ?? history.state,replaceUrl:true});
      return;
    }
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
    const zone = !this.inland && this.coastalZones.find((z) => z.id === p.get("zone"));
    const commune = p.get("commune");
    if (commune) this.chooseCommune(commune);
    else if (p.get("near") === "1") {
      const state = this.router.getCurrentNavigation()?.extras.state ?? history.state;
      const position = state?.["nearbyPosition"];
      if (this.validPosition(position)) this.loadNearby(position);
      else {
        this.loadBeaches();
        this.message = "La position privée n'est pas disponible dans ce lien.";
      }
    }
    else {
      if (zone) this.exploreZone(zone);
      else this.loadBeaches();
      if (this.query.trim().length >= 2) this.findCommunes();
    }
  }
  onQueryChange(): void {
    this.cancelLocation();
    this.message = "";
    clearTimeout(this.placeTimer);
    this.placeRequest?.unsubscribe();
    this.communeSuggestions = [];
    this.activeSuggestion = -1;
    if (this.communeCode || this.selectedCommune || this.communePending || this.nearbyPosition) {
      this.selectedCommune = null;
      this.communeCode = null;
      this.nearbyPosition = null;
      this.selectedBeach = null;
      this.score = null;
    }
    this.syncFilters();
    if (this.query.trim().length >= 2)
      this.placeTimer = setTimeout(() => this.findCommunes(), 350);
  }
  private findCommunes(): void {
    const query = this.query.trim();
    this.placeRequest?.unsubscribe();
    this.placeRequest = this.api
      .searchCommunes(query)
      .pipe(timeout(12000))
      .subscribe({
        next: (communes) => {
          if (query !== this.query.trim()) return;
          this.communeSuggestions = communes;
          const normalize = (value: string) =>
            value
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLocaleLowerCase("fr");
          const exact = communes.filter(
            (c) => normalize(c.name) === normalize(query),
          );
          if (exact.length === 1) this.chooseCommune(exact[0].code);
          this.cdr.markForCheck();
        },
        error: () => {
          this.message =
            "Recherche de commune indisponible. Résultats du catalogue local affichés.";
          this.cdr.markForCheck();
        },
      });
  }
  onPlaceKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.communeSuggestions = [];
      this.activeSuggestion = -1;
      return;
    }
    if (!this.communeSuggestions.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const length = this.communeSuggestions.length;
      this.activeSuggestion =
        (this.activeSuggestion +
          (event.key === "ArrowDown" ? 1 : -1) +
          length) %
        length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.chooseCommune(
        this.communeSuggestions[Math.max(0, this.activeSuggestion)].code,
      );
    }
  }
  chooseCommune(code: string): void {
    this.cancelLocation();
    this.nearbyPosition = null;
    this.communeCode = code;
    clearTimeout(this.placeTimer);
    this.placeRequest?.unsubscribe();
    this.listRequest?.unsubscribe();
    this.scoreRequest?.unsubscribe();
    this.communeSuggestions = [];
    this.activeSuggestion = -1;
    this.selectedZone = null;
    this.selectedCommune = null;
    this.clearPreview();
    this.communePending = true;
    this.loading = true;
    this.error = "";
    this.message = "";
    this.syncFilters(false);
    this.runSearch();
  }
  clearCommune(): void {
    this.selectedCommune = null;
    this.communeCode = null;
    this.query = "";
    this.message = "";
    this.onQueryChange();
  }
  loadBeaches(): void {
    this.cancelLocation();
    this.runSearch();
  }
  private runSearch(): void {
    this.listRequest?.unsubscribe();
    this.clearPreview();
    this.loading = true;
    this.error = "";
    if ((this.minWaterTemp !== null && (this.minWaterTemp < 0 || this.minWaterTemp > 45)) ||
      (this.maxWaterTemp !== null && (this.maxWaterTemp < 0 || this.maxWaterTemp > 45)) ||
      (this.minWaterTemp !== null && this.maxWaterTemp !== null && this.minWaterTemp > this.maxWaterTemp)) {
      this.loading = false;
      this.initialLoad = false;
      this.beaches = [];
      this.error = "La température minimale doit être inférieure ou égale au maximum, entre 0 et 45 °C.";
      return;
    }
    const hasScope = !!(this.nearbyPosition || this.communeCode || this.selectedZone);
    const criteria: BeachSearch = {
      usage: this.selectedUsage as BeachSearch['usage'],
      sort: (this.sort === 'distance' && !hasScope ? 'name' : this.sort) as BeachSearch['sort'],
      ...(this.communeCode ? { communeCode: this.communeCode } : this.nearbyPosition
        ? { ...this.nearbyPosition, radiusKm: 50 } : this.selectedZone ? { bbox: this.selectedZone.bbox } : {}),
      ...(!this.communeCode && this.query.trim() ? { q: this.query.trim() } : {}),
      ...(this.waterType !== 'all' ? { waterType: this.waterType as BeachSearch['waterType'] } : {}),
      ...(this.requiredFlag !== 'all' ? { flag: this.requiredFlag as BeachSearch['flag'] } : {}),
      ...(this.requireParking ? { parking: true } : {}),
      ...(this.requireToilets ? { toilets: true } : {}),
      ...(this.requireLifeguard ? { rescueStation: true } : {}),
      ...(this.minWaterTemp !== null ? { minWaterTemp: this.minWaterTemp } : {}),
      ...(this.maxWaterTemp !== null ? { maxWaterTemp: this.maxWaterTemp } : {}),
    };
    this.listRequest = this.api
      .searchBeaches(criteria)
      .pipe(timeout(30000))
      .subscribe({
        next: (r) => {
          this.beaches = r.items;
          this.resultLimit = 20;
          this.communePending = false;
          if (r.commune) {
            this.selectedCommune = r.commune;
            this.query = r.commune.name;
            this.syncFilters(false);
          }
          const notes = [];
          if (this.communeCode) notes.push("Plages référencées dans la commune. Inventaire non exhaustif.");
          if (this.nearbyPosition) notes.push("Plages à moins de 50 km de votre position.");
          if (this.minWaterTemp !== null || this.maxWaterTemp !== null) notes.push(`${r.coverage.waterTemperature} plage(s) avec une température récente sur ${r.coverage.candidates}. Valeurs inconnues exclues.`);
          if (this.requiredFlag !== 'all') notes.push("Drapeaux issus d'un consensus communautaire, non officiels.");
          if (notes.length) this.message = notes.join(' ');
          this.loading = false;
          this.initialLoad = false;
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.communePending = false;
          this.loading = false;
          this.initialLoad = false;
          this.beaches = [];
          this.error = error.status === 409 ? "La recherche a expiré. Relancez-la pour actualiser les résultats."
            : "Les plages ne sont pas disponibles pour le moment.";
          this.cdr.markForCheck();
        },
      });
  }
  exploreZone(zone: CoastalZone): void {
    this.cancelLocation();
    this.nearbyPosition = null;
    this.communeCode = null;
    clearTimeout(this.placeTimer);
    this.placeRequest?.unsubscribe();
    this.selectedCommune = null;
    this.communePending = false;
    this.clearPreview();
    this.communeSuggestions = [];
    this.selectedZone = zone;
    this.loading = true;
    this.error = "";
    this.message = "";
    this.selectedBeach = null;
    this.score = null;
    this.listRequest?.unsubscribe();
    this.scoreRequest?.unsubscribe();
    this.syncFilters(false);
    this.runSearch();
  }
  chooseZone(id: string): void {
    this.cancelLocation();
    this.nearbyPosition = null;
    this.communeCode = null;
    clearTimeout(this.placeTimer);
    this.placeRequest?.unsubscribe();
    this.communeSuggestions = [];
    this.query = "";
    this.selectedCommune = null;
    const zone = this.coastalZones.find((z) => z.id === id);
    if (zone) this.exploreZone(zone);
    else {
      this.selectedZone = null;
      this.syncFilters(false);
      this.loadBeaches();
    }
  }
  useMyPosition(): void {
    this.cancelLocation();
    const attempt = this.locationAttempt;
    if (!navigator.geolocation) {
      this.message = "La localisation est indisponible. Choisissez une façade.";
      return;
    }
    this.locating = true;
    this.message = "";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (this.destroyed || attempt !== this.locationAttempt) return;
        this.locating = false;
        const position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (this.validPosition(position)) this.loadNearby(position);
        else this.message = "Position non disponible. Vous pouvez choisir une façade ou une ville.";
        this.cdr.markForCheck();
      },
      () => {
        if (this.destroyed || attempt !== this.locationAttempt) return;
        this.locating = false;
        this.message =
          "Position non disponible. Vous pouvez choisir une façade ou une ville.";
        this.cdr.markForCheck();
      },
      { timeout: 8000, maximumAge: 120000 },
    );
  }
  private validPosition(position: any): position is { lat: number; lon: number } {
    return position && Number.isFinite(position.lat) && Number.isFinite(position.lon)
      && Math.abs(position.lat) <= 90 && Math.abs(position.lon) <= 180;
  }
  private cancelLocation(): void {
    ++this.locationAttempt;
    this.locating = false;
  }
  private loadNearby(position: { lat: number; lon: number }): void {
    this.cancelLocation();
    this.loading = true;
    this.error = "";
    this.selectedZone = null;
    this.selectedCommune = null;
    this.communeCode = null;
    this.nearbyPosition = { ...position };
    this.communePending = false;
    this.communeSuggestions = [];
    this.activeSuggestion = -1;
    this.clearPreview();
    this.query = "";
    this.placeRequest?.unsubscribe();
    clearTimeout(this.placeTimer);
    this.listRequest?.unsubscribe();
    this.syncFilters(false);
    this.runSearch();
  }
  loadScore(beach: Beach): void {
    this.cancelLocation();
    this.scoreRequest?.unsubscribe();
    if (this.selectedBeach?.id !== beach.id) this.score = null;
    this.selectedBeach = beach;
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
          this.score = null;
          this.loadingScore = false;
          this.scoreError = "Conditions indisponibles pour cette plage.";
          this.cdr.markForCheck();
        },
      });
  }
  private clearPreview(): void {
    this.scoreRequest?.unsubscribe();
    this.selectedBeach = null;
    this.score = null;
    this.loadingScore = false;
    this.scoreError = "";
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
    return this.beaches;
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
    this.cancelLocation();
    clearTimeout(this.placeTimer);
    this.placeRequest?.unsubscribe();
    this.communeSuggestions = [];
    this.activeSuggestion = -1;
    this.selectedCommune = null;
    this.communeCode = null;
    this.query = "";
    this.requiredFlag = "all";
    this.requireParking = false;
    this.requireToilets = false;
    this.requireLifeguard = false;
    this.minWaterTemp = null;
    this.maxWaterTemp = null;
    this.syncFilters();
  }
  retrySearch(): void {
    if (this.communeCode) this.chooseCommune(this.communeCode);
    else if (this.nearbyPosition) this.loadNearby(this.nearbyPosition);
    else if (this.selectedZone) this.exploreZone(this.selectedZone);
    else this.loadBeaches();
  }
  filterCount(): number {
    return (
      Number(this.requiredFlag !== "all") +
      Number(this.requireParking) +
      Number(this.requireToilets) +
      Number(this.requireLifeguard) +
      Number(this.minWaterTemp !== null || this.maxWaterTemp !== null)
    );
  }
  syncFilters(reload = true): void {
    const queryParams = {
        q: this.query || null,
        commune: this.communeCode,
        zone: this.selectedZone?.id ?? null,
        usage: this.inland ? null : this.selectedUsage,
        water: this.waterType === "all" ? null : this.waterType,
        parking: this.requireParking ? "1" : null,
        toilets: this.requireToilets ? "1" : null,
        rescue: this.requireLifeguard ? "1" : null,
        flag: this.requiredFlag === "all" ? null : this.requiredFlag,
        min: this.minWaterTemp,
        max: this.maxWaterTemp,
        sort: this.sort === "name" ? null : this.sort,
        near: this.nearbyPosition ? "1" : null,
      };
    this.writtenParams = this.paramsKey(queryParams);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      state: this.navigationState,
      scroll: 'manual',
      replaceUrl: true,
    });
    if (reload) {
      this.message = '';
      this.runSearch();
    }
  }
  private paramsKey(params: Record<string, unknown>): string {
    return JSON.stringify(Object.entries(params).filter(([,v]) => v != null)
      .map(([k,v]) => [k,String(v)]).sort(([a],[b]) => a.localeCompare(b)));
  }
  get navigationState() {
    return { nearbyPosition: this.nearbyPosition };
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
    this.cancelLocation();
    this.routeRequest?.unsubscribe();
    this.listRequest?.unsubscribe();
    this.scoreRequest?.unsubscribe();
    this.placeRequest?.unsubscribe();
    clearTimeout(this.placeTimer);
  }
}
