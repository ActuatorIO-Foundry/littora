import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { Subscription, timeout } from "rxjs";
import type { Alerts } from "@littora/api-client/models";
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
import { LoadingComponent } from "../../shared/loading.component";
import { CoastMapComponent } from "../../shared/coast-map.component";
import {
  metricValue,
  metricClass,
  providerLabel,
  dataStatusLabel,
} from "../../shared/presentation";
type UsageKey = "bathing" | "family" | "paddle" | "boat";
interface Report {
  type: string;
  created_at: string;
  value?: { flag?: string };
}
@Component({
  selector: "app-beach-detail",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    IconComponent,
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
  selectedChart = "air";
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
      text: "Conditions de baignade et équipements référencés à proximité.",
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
    { key: "air", label: "Air", unit: "°C", icon: "sun" },
    { key: "water", label: "Eau", unit: "°C", icon: "waves" },
    { key: "uv", label: "UV", unit: "", icon: "sun" },
    { key: "wave", label: "Vagues", unit: "m", icon: "waves" },
    { key: "current", label: "Courant", unit: "m/s", icon: "water" },
  ];
  readonly groups: Array<{
    category: BeachAmenity["category"];
    name: string;
    icon: string;
  }> = [
    { category: "parking", name: "Stationnement", icon: "parking" },
    { category: "toilets", name: "Toilettes", icon: "toilets" },
    { category: "rescue", name: "Poste de secours", icon: "rescue" },
    { category: "rental", name: "Locations nautiques", icon: "boat" },
    { category: "food", name: "Restauration", icon: "compass" },
  ];
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
    this.subscriptions.add(this.route.paramMap.subscribe(params => this.loadBeach(params.get("id"))));
  }
  private loadBeach(id: string | null): void {
    clearTimeout(this.shomExpiry);
    clearTimeout(this.vigilanceTimer);
    this.vigilance = null;
    clearTimeout(this.scoreTimer);
    this.beachRequests.unsubscribe();
    this.beachRequests = new Subscription();
    this.scoreRequest?.unsubscribe();
    this.beach = null;
    this.score = null;
    this.amenities = null;
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
    if (!background) { this.score = null; this.loadingScore = true; }
    this.scoreError = "";
    this.scoreRequest?.unsubscribe();
    this.scoreRequest = this.api
      .getScore(id)
      .pipe(timeout(25000))
      .subscribe({
        next: (r) => {
          this.score = r;
          this.updateShomExpiry();
          const now = Date.now();
          const times = Object.values(r.dataStatus ?? {}).flatMap(s => [
            s.nextCheckAt ? Date.parse(s.nextCheckAt) - now : Infinity,
            s.validAt ? Date.parse(s.validAt) + 1800001 - now : Infinity,
          ]).filter(n => Number.isFinite(n) && n > 0);
          this.scoreTimer = setTimeout(() => this.loadScore(id, true),
            Math.max(60000, Math.min(times.length ? 3600000 : 300000, ...times)));
          this.loadingScore = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.score = null;
          this.scoreTimer = setTimeout(() => this.loadScore(id, true), 300000);
          this.loadingScore = false;
          this.scoreError =
            "Conditions indisponibles. Les informations de la plage restent consultables.";
          this.cdr.markForCheck();
        },
      });
  }
  private loadReports(id: string): void {
    this.beachRequests.add(
      this.api
        .getReports(id)
        .pipe(timeout(12000))
        .subscribe({
          next: (r) => {
            this.reports = r as Report[];
            this.reportsUnavailable = false;
            this.cdr.markForCheck();
          },
          error: () => {
            this.reportsUnavailable = true;
            this.cdr.markForCheck();
          },
        }),
    );
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
  get points(): MetricPoint[] {
    return (this.score?.forecast?.[this.selectedChart] ?? []).filter(
      (p) => Number.isFinite(Date.parse(p.time)),
    );
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
    return this.points.map((p, i) => {
      if (p.value === null || !Number.isFinite(p.value)) { connected = false; return ''; }
      const command = connected ? 'L' : 'M';
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
  get realAmenities(): BeachAmenity[] {
    return (this.amenities?.amenities ?? []).filter(
      (a) => a.source !== "local-hint" && a.verification !== "to_verify",
    );
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
  flagLabel(flag?: string | null): string {
    return flag
      ? ((
          { green: "Vert", yellow: "Jaune", red: "Rouge" } as Record<
            string,
            string
          >
        )[flag] ?? flag)
      : "";
  }
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
    clearTimeout(this.shomExpiry);
    clearTimeout(this.vigilanceTimer);
    clearTimeout(this.scoreTimer);
    this.subscriptions.unsubscribe();
    this.beachRequests.unsubscribe();
    this.scoreRequest?.unsubscribe();
  }
}
