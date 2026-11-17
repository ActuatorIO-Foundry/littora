import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { Subscription, timeout } from "rxjs";
import {
  Beach,
  BeachAmenity,
  BeachAmenitiesResponse,
  BeachScore,
  MetricPoint,
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
  private scoreRequest?: Subscription;
  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: LittoraApiService,
    private readonly cdr: ChangeDetectorRef,
  ) {}
  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get("id");
    if (!id) {
      this.error = "Plage introuvable.";
      this.loading = false;
      return;
    }
    this.subscriptions.add(
      this.api
        .getBeach(id)
        .pipe(timeout(15000))
        .subscribe({
          next: (b) => {
            this.beach = b;
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
    this.subscriptions.add(
      this.api
        .getBeachAmenities(id)
        .pipe(timeout(20000))
        .subscribe({
          next: (r) => {
            this.amenities = r;
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
  loadScore(id: string): void {
    this.loadingScore = true;
    this.scoreError = "";
    this.scoreRequest?.unsubscribe();
    this.scoreRequest = this.api
      .getScore(id)
      .pipe(timeout(25000))
      .subscribe({
        next: (r) => {
          this.score = r;
          this.loadingScore = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loadingScore = false;
          this.scoreError =
            "Conditions indisponibles. Les informations de la plage restent consultables.";
          this.cdr.markForCheck();
        },
      });
  }
  private loadReports(id: string): void {
    this.subscriptions.add(
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
    flag?: string,
  ): void {
    if (!this.beach || this.sending) return;
    this.sending = true;
    this.reportMessage = "";
    this.reportError = "";
    this.subscriptions.add(
      this.api
        .createReport({
          beachId: this.beach.id,
          type,
          value: { ...(flag ? { flag } : {}), source: "detail-page" },
          confidence: 0.7,
        })
        .pipe(timeout(12000))
        .subscribe({
          next: () => {
            this.sending = false;
            this.reportMessage =
              "Observation enregistrée. Merci pour votre contribution.";
            this.loadReports(this.beach!.id);
            this.cdr.markForCheck();
          },
          error: () => {
            this.sending = false;
            this.reportError = "L’observation n’a pas pu être envoyée.";
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
  flagLabel(flag?: string): string {
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
    this.subscriptions.unsubscribe();
    this.scoreRequest?.unsubscribe();
  }
}
