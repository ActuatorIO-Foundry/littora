import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { Subscription, timeout } from "rxjs";
import type { Alerts, ArsMeasurement, Report } from "@littora/api-client/models";
import {
  Beach,
  BeachAmenity,
  BeachAmenitiesResponse,
  BeachScore,
  MetricPoint,
  ReportPayload,
} from "../../models/beach.model";
import { LittoraApiService } from "../../services/littora-api.service";
import { IconComponent } from "../../shared/icon.component";
import { ComfortExplanationComponent } from '../../shared/comfort-explanation.component';
import { DogAccessComponent } from '../../shared/dog-access.component';
import { NaturismComponent } from '../../shared/naturism.component';
import { FlagBulletinComponent } from '../../shared/flag-bulletin.component';
import { LoadingComponent } from "../../shared/loading.component";
import { CoastMapComponent } from "../../shared/coast-map.component";
import { amenityGroups, directionsTo, listedAmenities } from "../../shared/map-points";
import {
  metricValue,
  metricClass,
  providerLabel,
  dataStatusLabel,
  forecastIsStale,
  freshnessDeadline,
  flagLabel,
} from "../../shared/presentation";
type UsageKey = "bathing" | "family" | "paddle" | "boat";
@Component({
  selector: "app-beach-detail",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    IconComponent,
    ComfortExplanationComponent,
    DogAccessComponent,
    NaturismComponent,
    FlagBulletinComponent,
    LoadingComponent,
    CoastMapComponent,
  ],
  templateUrl: "./beach-detail.component.html",
  styleUrl: "./beach-detail.component.css",
})
export class BeachDetailComponent implements OnInit, OnDestroy {
  beach: Beach | null = null;
  score: BeachScore | null = null;
  vigilance: Alerts | null = null;
  readonly vigilanceLabels = { yellow:"jaune", orange:"orange", red:"rouge" };
  private vigilanceTimer?: ReturnType<typeof setTimeout>;
  amenities: BeachAmenitiesResponse | null = null;
  reports: Report[] = [];
  loadingReports = true;
  private reportTimer?: ReturnType<typeof setTimeout>;
  private reportRequest?: Subscription;
  loading = true;
  loadingScore = true;
  loadingAmenities = true;
  error = "";
  scoreError = "";
  reportError = "";
  reportMessage = "";
  sending = false;
  reportsUnavailable = false;
  amenitiesUnavailable = false;
  selectedUsage: UsageKey = "bathing";
  readonly sports = [
    {key:'paddle', label:'Paddle', description:'Le calme est privilégié. Vent, rafales, vagues et courant réduisent l’indice.'},
    {key:'catamaran', label:'Catamaran', description:'Pour la voile de loisir, le manque de vent comme le vent fort réduisent l’indice. Les rafales, les vagues et le courant comptent aussi.'},
    {key:'windsurf', label:'Planche à voile', description:'Ce profil privilégie un vent établi pour la glisse. Le petit temps, le vent fort, les rafales et une mer agitée réduisent l’indice.'},
  ] as const;
  sport: (typeof this.sports)[number] = this.sports[0];
  readonly directionsTo = directionsTo;
  chooseSport(key: string) {
    this.sport = this.sports.find(s => s.key === key) ?? this.sports[0];
  }
  explanation(usage: UsageKey) {
    return this.score?.explanations?.[usage === 'paddle' ? this.sport.key : usage];
  }
  completeScore(usage: UsageKey) {
    const e = this.explanation(usage);
    if (e) return e.score;
    return usage === 'paddle' && this.sport.key !== 'paddle' ? null : this.score?.scores[usage];
  }
  get windOrigin(): string {
    const weather = this.score?.current?.weather;
    const meta = this.score?.dataStatus?.['weather'];
    if (!meta || meta.kind !== 'forecast' || meta.status === 'unknown') return 'Direction non renseignée';
    if (weather?.['wind_speed_10m'] === 0 && meta.units?.['wind_speed_10m'] === 'km/h') return 'Vent calme · sans direction';
    const degrees = weather?.['wind_direction_10m'];
    if (meta?.units?.['wind_direction_10m'] !== '°' || typeof degrees !== 'number' || !Number.isFinite(degrees) || degrees < 0 || degrees > 360) return 'Direction non renseignée';
    const compass = ['nord','nord-est','est','sud-est','sud','sud-ouest','ouest','nord-ouest'];
    return 'Provenance : '+compass[Math.round(degrees/45)%8]+' · '+Math.round(degrees)%360+'°';
  }
  selectedChart = "air";
  get freshwater() { return this.beach?.waterType === 'lake' || this.beach?.waterType === 'river'; }
  get applicableCharts() { return this.beach?.waterType === 'sea' ? this.charts : this.charts.filter(c=>c.group==='weather'); }
  sanitaryReading(m?: ArsMeasurement): string {
    if (m?.value == null || m.qualifier === 'missing') return 'non renseigné';
    const value = m.value.toLocaleString('fr-FR') + ' / 100 ml';
    return m.qualifier === 'detection-limit' ? 'limite de détection : ' + value : value;
  }
  readonly metricValue = metricValue;
  readonly metricClass = metricClass;
  readonly providerLabel = providerLabel;
  readonly dataStatusLabel = dataStatusLabel;
  readonly usages: Array<{
    key: UsageKey;
    label: string;
    icon: string;
    text: string;
  }> = [
    {
      key: "bathing",
      label: "Baignade",
      icon: "bathing",
      text: "Température de l’eau, vagues, vent et qualité sanitaire.",
    },
    {
      key: "family",
      label: "Famille",
      icon: "family",
      text: "Vent, vagues, courant, UV et température de l’eau. Les équipements sont indiqués séparément.",
    },
    {
      key: "paddle",
      label: "Sports nautiques",
      icon: "wind",
      text: "Vent, rafales, houle et courant pour préparer la sortie.",
    },
    {
      key: "boat",
      label: "Bateau",
      icon: "boat",
      text: "Vent et état de la mer pour une première lecture de la côte.",
    },
  ];
  readonly charts = [
    { key: "air", group: "weather", label: "Air", unit: "°C", icon: "sun" },
    { key: "water", group: "marine", label: "Eau", unit: "°C", icon: "waves" },
    { key: "uv", group: "weather", label: "UV", unit: "", icon: "sun" },
    { key: "wave", group: "marine", label: "Vagues", unit: "m", icon: "waves" },
    { key: "current", group: "marine", label: "Courant", unit: "m/s", icon: "water" },
  ];
  realAmenities: BeachAmenity[] = [];
  get groups() {
    return amenityGroups.filter(g => g.category !== 'other' || this.realAmenities.some(p => p.category === 'other'));
  }
  private readonly subscriptions = new Subscription();
  private beachRequests = new Subscription();
  private scoreRequest?: Subscription;
  private scoreTimer?: ReturnType<typeof setTimeout>;
  private shomExpiry?: ReturnType<typeof setTimeout>;
  get activeHeightReference() {
    const r=this.score?.current?.tides?.heightReference;
    return r && Date.parse(r.expiresAt)>Date.now() ? r : null;
  }
  get activeCurrentReference() {
    const r=this.score?.current?.tides?.currentReference;
    return r && Date.parse(r.expiresAt)>Date.now() ? r : null;
  }
  private updateShomExpiry(): void {
    clearTimeout(this.shomExpiry);
    const ends=[this.activeHeightReference,this.activeCurrentReference]
      .flatMap(r=>r ? [Date.parse(r.expiresAt)] : []);
    if (ends.length) this.shomExpiry=setTimeout(()=>{
      this.cdr.markForCheck();
      this.updateShomExpiry();
    },Math.max(1,Math.min(...ends)-Date.now()+1));
  }
  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: LittoraApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}
  ngOnInit(): void {
    this.subscriptions.add(this.route.queryParamMap.subscribe(p => {
      this.selectedUsage = this.usages.find(u => u.key === p.get('usage'))?.key ?? 'bathing';
    }));
    this.subscriptions.add(this.route.paramMap.subscribe(params => this.loadBeach(params.get("id"))));
  }
  private loadBeach(id: string | null): void {
    clearTimeout(this.reportTimer);
    this.reportRequest?.unsubscribe();
    this.loadingReports = true;
    clearTimeout(this.shomExpiry);
    clearTimeout(this.vigilanceTimer);
    this.vigilance = null;
    clearTimeout(this.scoreTimer);
    this.beachRequests.unsubscribe();
    this.beachRequests = new Subscription();
    this.scoreRequest?.unsubscribe();
    this.beach = null;
    this.selectedChart = "air";
    this.score = null;
    this.amenities = null;
    this.realAmenities = [];
    this.reports = [];
    this.loading = true;
    this.loadingScore = true;
    this.loadingAmenities = true;
    this.error = "";
    this.scoreError = "";
    this.reportError = "";
    this.reportMessage = "";
    this.sending = false;
    this.reportsUnavailable = false;
    this.amenitiesUnavailable = false;
    if (!id) {
      this.error = "Plage introuvable.";
      this.loading = false;
      return;
    }
    this.beachRequests.add(
      this.api
        .getBeach(id)
        .pipe(timeout(15000))
        .subscribe({
          next: (b) => {
            this.beach = b;
            if (b.waterType === 'sea') this.loadVigilance(id);
            this.loading = false;
            this.cdr.markForCheck();
          },
          error: () => {
            this.error = "Cette plage ne peut pas être chargée.";
            this.loading = false;
            this.cdr.markForCheck();
          },
        }),
    );
    this.loadScore(id);
    this.beachRequests.add(
      this.api
        .getBeachAmenities(id)
        .pipe(timeout(20000))
        .subscribe({
          next: (r) => {
            this.amenities = r;
            this.realAmenities = listedAmenities(r.amenities);
            this.amenitiesUnavailable = r.status === 'unknown';
            this.loadingAmenities = false;
            this.cdr.markForCheck();
          },
          error: () => {
            this.loadingAmenities = false;
            this.amenitiesUnavailable = true;
            this.cdr.markForCheck();
          },
        }),
    );
    this.loadReports(id);
  }
  private loadVigilance(id: string): void {
    const update = (result: Alerts | null) => {
      const remaining = result?.checkBy ? Date.parse(result.checkBy) - Date.now() : 0;
      this.vigilance = result?.status === 'available' && remaining > 0 ? result : null;
      this.cdr.markForCheck();
      this.vigilanceTimer = setTimeout(() => {
        this.vigilance = null;
        this.cdr.markForCheck();
        this.loadVigilance(id);
      }, this.vigilance ? Math.min(remaining, 300000) : 60000);
    };
    this.beachRequests.add(this.api.getVigilance(id).pipe(timeout(10000)).subscribe({
      next: update, error: () => update(null),
    }));
  }
  loadScore(id: string, background = false): void {
    clearTimeout(this.scoreTimer);
    if (!background) this.loadingScore = !this.score;
    if (!this.score) this.scoreError = "";
    this.cdr.markForCheck();
    this.scoreRequest?.unsubscribe();
    this.scoreRequest = this.api
      .getScore(id)
      .pipe(timeout(25000))
      .subscribe({
        next: (r) => {
          this.score = r;
          this.scoreError = "";
          this.updateShomExpiry();
          const now = Date.now();
          const times = Object.values(r.dataStatus ?? {}).flatMap(s => [
            s.nextCheckAt ? Date.parse(s.nextCheckAt) - now : Infinity,
            s.validAt ? Date.parse(s.validAt) + 1800001 - now : Infinity,
            freshnessDeadline(s) - now,
          ]).filter(n => Number.isFinite(n) && n > 0);
          const retry = Object.values(r.dataStatus ?? {}).some(s =>
            s.status === 'stale' || (s.nextCheckAt && Date.parse(s.nextCheckAt) <= now));
          this.scoreTimer = setTimeout(() => this.loadScore(id, true),
            Math.min(times.length && !retry ? 3600000 : 300000, ...times));
          this.loadingScore = false;
          this.cdr.markForCheck();
        },
        error: () => {
          const previous = this.score;
          if (previous) {
            // Only dated forecasts survive a failed refresh, never a safety decision or index.
            const dataStatus = Object.fromEntries(Object.entries(previous.dataStatus ?? {})
              .filter(([key, status]) => ['weather','marine'].includes(key) &&
                status.kind === 'forecast' && status.fetchedAt && status.validAt && status.status !== 'unknown')
              .map(([key, status]) => [key, {...status,status:'stale' as const}]));
            this.score = {
              beach: previous.beach, scores: {bathing:null, family:null, paddle:null, boat:null},
              current: {weather: dataStatus['weather'] ? previous.current?.weather : undefined,
                marine: dataStatus['marine'] ? previous.current?.marine : undefined},
              dataStatus, providers:previous.providers, measurements:previous.measurements,
            };
            this.updateShomExpiry();
          }
          this.scoreTimer = setTimeout(() => this.loadScore(id, true), 300000);
          this.loadingScore = false;
          this.scoreError = Object.keys(this.score?.dataStatus ?? {}).length
            ? "Actualisation indisponible. Dernières prévisions connues ; indices et conditions actuelles non confirmés."
            : "Conditions indisponibles. Les informations de la plage restent consultables.";
          this.cdr.markForCheck();
        },
      });
  }
  private loadReports(id: string): void {
    clearTimeout(this.reportTimer);
    this.reportRequest?.unsubscribe();
    const previous = this.reports;
    this.reports = previous.filter(r => Date.parse(r.expires_at ?? '') > Date.now());
    this.cdr.markForCheck();
    this.reportRequest = this.api
        .getReports(id)
        .pipe(timeout(12000))
        .subscribe({
          next: (r) => {
            const now = Date.now();
            this.reports = r.filter(item => item.status === 'verified' && item.provenance?.verified &&
              !item.provenance.isDemo && Date.parse(item.expires_at ?? '') > now);
            const changed = previous.length !== this.reports.length || previous.some((p,i) => this.reports[i]?.id !== p.id);
            if (!this.loadingReports && (changed || this.score?.safety?.communityFlag)) this.loadScore(id,true);
            this.loadingReports = false;
            this.reportsUnavailable = false;
            this.reportTimer = setTimeout(() => this.loadReports(id), Math.min(60000,
              ...this.reports.map(item => Date.parse(item.expires_at!) - now)));
            this.cdr.markForCheck();
          },
          error: () => {
            this.loadingReports = false;
            this.reports = [];
            this.reportsUnavailable = true;
            this.reportTimer = setTimeout(() => this.loadReports(id),60000);
            this.cdr.markForCheck();
          },
        });
  }
  get feedReports() {
    const history = new Set(this.score?.safety?.communityFlag?.history.map(entry => entry.reportId));
    return this.reports.filter(report => !history.has(report.id));
  }
  get backQuery() {
    return this.route.snapshot.queryParams;
  }
  get backState() {
    return { nearbyPosition: history.state?.nearbyPosition ?? null };
  }
  get selectedUsageInfo() {
    return this.usages.find((u) => u.key === this.selectedUsage)!;
  }
  get chart() {
    return this.charts.find((c) => c.key === this.selectedChart)!;
  }
  get chartStatus() {
    return this.score?.dataStatus?.[this.chart.group];
  }
  oldReading(group: 'weather' | 'marine', key: string): boolean {
    const status = this.score?.dataStatus?.[group];
    return !!status && this.score?.current?.[group]?.[key] != null && forecastIsStale(status);
  }
  get chartCaption(): string {
    const status = this.chartStatus;
    if (!status) return '';
    return 'Source unique : ' + providerLabel(status.provider) +
      ' · Collecte : ' + this.dateLabel(status.fetchedAt) +
      (forecastIsStale(status) ? ' · Prévision périmée' : '');
  }
  get points(): MetricPoint[] {
    const status = this.chartStatus;
    const marine = this.chart.group === 'marine';
    if (!status || status.kind !== 'forecast' || status.status === 'unknown' ||
        (marine && this.score?.beach.waterType !== 'sea') ||
        status.provider !== (marine ? 'open-meteo-marine' : 'open-meteo')) return [];
    const fetched = Date.parse(status.fetchedAt ?? '');
    if (!Number.isFinite(fetched)) return [];
    const points = this.score?.measurements?.forecast[this.selectedChart] ?? [];
    return points.flatMap(p => {
      if (!p.validAt || !Number.isFinite(Date.parse(p.validAt))) return [];
      const compatible = p.kind === 'forecast' && p.isDemo === false && p.source.provider === status.provider &&
        p.unit === this.chart.unit && Date.parse(p.fetchedAt ?? '') === fetched &&
        (p.status === 'stale' || p.status === 'available') && Number.isFinite(p.value);
      return [{time:p.validAt, value:compatible ? p.value : null}];
    });
  }
  get bounds() {
    const values = this.points.map((p) => p.value).filter((v): v is number => v !== null && Number.isFinite(v));
    const min = Math.floor(Math.min(...values) - 1);
    return {
      min:
        this.selectedChart === "air" || this.selectedChart === "water"
          ? min
          : Math.max(0, min),
      max: Math.ceil(Math.max(...values, 1)) + 1,
    };
  }
  chartX(index: number): number {
    const points = this.points;
    const start = Date.parse(points[0]?.time);
    const end = Date.parse(points[points.length - 1]?.time);
    return 48 + ((Date.parse(points[index]?.time) - start) / Math.max(end - start, 1)) * 660;
  }
  chartY(value: number): number {
    const b = this.bounds;
    return 184 - ((value - b.min) / (b.max - b.min)) * 150;
  }
  chartPath(): string {
    let connected = false;
    return this.points.map((p, i, points) => {
      if (p.value === null || !Number.isFinite(p.value)) { connected = false; return ''; }
      const consecutive = i > 0 && Date.parse(p.time) - Date.parse(points[i-1].time) === 3600000;
      const command = connected && consecutive ? 'L' : 'M';
      connected = true;
      return `${command}${this.chartX(i)},${this.chartY(p.value)}`;
    }).join(' ');
  }
  get hasForecast(): boolean {
    return this.points.some(p => p.value !== null && Number.isFinite(p.value));
  }
  chartTime(time: string): string {
    const date = new Date(time);
    return Number.isNaN(date.getTime())
      ? "—"
      : new Intl.DateTimeFormat("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(date);
  }
  get chartTicks() {
    const b = this.bounds;
    return [b.min, (b.min + b.max) / 2, b.max];
  }
  amenitiesBy(category: BeachAmenity["category"]): BeachAmenity[] {
    return this.realAmenities.filter((a) => a.category === category);
  }
  signal(
    type: "jellyfish" | "pollution" | "current" | "crowd" | "flag",
    flag?: 'green' | 'yellow' | 'red',
  ): void {
    if (!this.beach || this.sending) return;
    let payload: ReportPayload;
    if (type === 'flag') {
      if (!flag) return;
      payload = { beachId: this.beach.id, type, value: { flag }, observedAt: new Date().toISOString() };
    } else {
      payload = { beachId: this.beach.id, type, value: {}, observedAt: new Date().toISOString() };
    }
    this.submitReport(payload);
  }
  contest(reportId: string): void {
    if (!this.beach || this.sending) return;
    this.submitReport({beachId:this.beach.id,type:'other',value:{contests:reportId}});
  }
  private submitReport(payload: ReportPayload): void {
    this.sending = true;
    this.reportMessage = "";
    this.reportError = "";
    this.beachRequests.add(
      this.api
        .createReport(payload)
        .pipe(timeout(12000))
        .subscribe({
          next: () => {
            this.sending = false;
            this.reportMessage =
              payload.type === 'other' ? "Contestation reçue. L’observation sera réexaminée." :
                "Observation reçue, en attente de modération. Merci.";
            this.loadReports(this.beach!.id);
            this.cdr.markForCheck();
          },
          error: (error) => {
            this.sending = false;
            this.reportError = error.status === 409 ? "Une observation similaire a déjà été reçue. Réessayez dans 15 minutes."
              : error.status === 429 ? "Trop de contributions rapprochées. Veuillez patienter avant de réessayer."
              : error.status === 401 ? "Votre session de contribution a expiré. Veuillez réessayer."
              : "L’observation n’a pas pu être envoyée.";
            this.cdr.markForCheck();
          },
        }),
    );
  }
  reportLabel(type: string): string {
    return (
      (
        {
          jellyfish: "Présence de méduses",
          pollution: "Pollution signalée",
          current: "Courant signalé",
          crowd: "Affluence",
          flag: "Drapeau observé",
        } as Record<string, string>
      )[type] ?? "Observation"
    );
  }
  readonly flagLabel = flagLabel;
  dateLabel(raw: unknown): string {
    if (!raw) return "Non renseignée";
    const d = new Date(String(raw));
    return Number.isNaN(d.getTime())
      ? "Non renseignée"
      : new Intl.DateTimeFormat("fr-FR", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }).format(d);
  }
  ngOnDestroy(): void {
    clearTimeout(this.reportTimer);
    this.reportRequest?.unsubscribe();
    clearTimeout(this.shomExpiry);
    clearTimeout(this.vigilanceTimer);
    clearTimeout(this.scoreTimer);
    this.subscriptions.unsubscribe();
    this.beachRequests.unsubscribe();
    this.scoreRequest?.unsubscribe();
  }
}
