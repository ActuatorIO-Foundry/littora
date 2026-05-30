import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { Beach, BeachAmenity, BeachAmenitiesResponse, BeachScore, MetricPoint } from '../../models/beach.model';

type UsageKey = 'bathing' | 'family' | 'paddle' | 'boat';

@Component({
    selector: 'app-beach-detail',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './beach-detail.component.html',
    styleUrl: './beach-detail.component.css'
})
export class BeachDetailComponent implements OnInit {
    beach: Beach | null = null;
    score: BeachScore | null = null;
    amenities: BeachAmenitiesResponse | null = null;
    reports: any[] = [];
    mapUrl: SafeResourceUrl | null = null;
    selectedSource: 'auto' | 'openmeteo' | 'meteofrance' | 'community' = 'auto';
    loading = true;
    error = '';
    status = 'initialisation';
    booted = false;

    readonly usages: Array<{ key: UsageKey; label: string; text: string }> = [
        { key: 'bathing', label: 'Baignade', text: 'Qualité d’eau, UV, vagues, courant et température de l’eau.' },
        { key: 'family', label: 'Famille', text: 'Baignade plus équipements: surveillance, toilettes, parking et confort.' },
        { key: 'paddle', label: 'Sports nautiques', text: 'Vent, rafales, houle et courant pénalisent fortement le score.' },
        { key: 'boat', label: 'Bateau', text: 'Lecture plaisance avec mer, rafales, courant et préparation de sortie.' }
    ];

    constructor(
        private readonly route: ActivatedRoute,
        private readonly sanitizer: DomSanitizer,
        private readonly cdr: ChangeDetectorRef
    ) {
        setTimeout(() => this.loadFromRoute(), 0);
    }

    ngOnInit(): void {
        this.loadFromRoute();
    }

    private async loadFromRoute(): Promise<void> {
        if (this.booted) return;
        this.booted = true;
        const id = this.route.snapshot.paramMap.get('id') || window.location.pathname.split('/').filter(Boolean).pop();
        if (!id) {
            this.error = 'Plage introuvable.';
            this.loading = false;
            return;
        }

        this.status = 'appel score';
        try {
            const score = await this.fetchJson<BeachScore>(`/api/score/beach/${id}`);
            this.score = score;
            this.beach = score.beach;
            this.mapUrl = this.buildMapUrl(score.beach);
            this.loading = false;
            this.status = 'score charge';
            this.cdr.detectChanges();
            this.loadExtras(id);
        } catch {
            this.error = 'Impossible de calculer les conditions de cette plage.';
            this.loading = false;
            this.status = 'erreur score';
            this.cdr.detectChanges();
        }
    }

    private async loadExtras(id: string): Promise<void> {
        try {
            this.amenities = await this.fetchJson<BeachAmenitiesResponse>(`/api/beaches/${id}/amenities`);
            this.cdr.detectChanges();
        } catch {
            this.amenities = null;
            this.cdr.detectChanges();
        }

        try {
            this.reports = await this.fetchJson<any[]>(`/api/reports?beachId=${id}`);
            this.cdr.detectChanges();
        } catch {
            this.reports = [];
            this.cdr.detectChanges();
        }
    }

    private async fetchJson<T>(url: string): Promise<T> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<T>;
    }

    metricValue(source: Record<string, unknown> | undefined, key: string, fallback = '—'): string {
        const value = source?.[key];
        if (value === null || value === undefined || value === '') return fallback;
        if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(1);
        return String(value);
    }

    metricClass(kind: 'air' | 'water' | 'uv' | 'wind' | 'wave' | 'salinity', raw: unknown): string {
        const value = Number(raw);
        if (!Number.isFinite(value)) return 'metric-neutral';

        if (kind === 'air' || kind === 'water') {
            if (value < 20) return 'metric-blue';
            if (value < 25) return 'metric-green';
            if (value < 30) return 'metric-orange';
            return 'metric-red';
        }

        if (kind === 'uv') {
            if (value < 3) return 'metric-green';
            if (value < 6) return 'metric-orange';
            return 'metric-red';
        }

        if (kind === 'wind') {
            if (value < 12) return 'metric-green';
            if (value < 25) return 'metric-orange';
            return 'metric-red';
        }

        if (kind === 'wave') {
            if (value < 0.5) return 'metric-green';
            if (value < 1.2) return 'metric-orange';
            return 'metric-red';
        }

        if (value >= 32 && value <= 39) return 'metric-green';
        if (value >= 28 && value < 32) return 'metric-orange';
        return 'metric-blue';
    }

    currentMetricClass(kind: 'air' | 'water' | 'uv' | 'wind' | 'wave' | 'salinity', source: Record<string, unknown> | undefined, key: string): string {
        return this.metricClass(kind, source?.[key]);
    }

    providerLabel(provider?: string): string {
        const labels: Record<string, string> = {
            'open-meteo': 'Open-Meteo Forecast API',
            'open-meteo-marine': 'Open-Meteo Marine API',
            'open-meteo-mapped': 'Météo-France à configurer, Open-Meteo actif',
            'local-weather-fallback': 'Fallback local météo',
            'local-marine-fallback': 'Fallback local marine',
            'local-tide-estimator': 'Estimateur local marées',
            'baignades-sante/data-gouv-ready': 'ARS / data.gouv à ingérer',
            'littora-reports': 'Signalements Littora'
        };
        return provider ? labels[provider] ?? provider : 'Non disponible';
    }

    flagText(): string {
        const flag = this.score?.safety?.flag;
        if (flag === 'green') return 'Drapeau vert estimé';
        if (flag === 'yellow') return 'Drapeau jaune estimé';
        if (flag === 'red') return 'Drapeau rouge estimé';
        return 'Drapeau à confirmer';
    }

    amenitiesBy(category: BeachAmenity['category']): BeachAmenity[] {
        return this.amenities?.amenities.filter((amenity) => amenity.category === category).slice(0, 5) ?? [];
    }

    chartValues(key: string, fallback: number): MetricPoint[] {
        const points = this.score?.forecast?.[key];
        if (points?.length) return points;
        return Array.from({ length: 8 }, (_, index) => ({
            time: `${index * 3}h`,
            value: Math.max(0, fallback + Math.sin(index / 1.4) * fallback * 0.08)
        }));
    }

    chartHeight(point: MetricPoint, points: MetricPoint[]): number {
        const values = points.map((item) => item.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        if (max === min) return 42;
        return 20 + ((point.value - min) / (max - min)) * 52;
    }

    private buildMapUrl(beach: Beach): SafeResourceUrl {
        const delta = 0.018;
        const bbox = [
            beach.lon - delta,
            beach.lat - delta,
            beach.lon + delta,
            beach.lat + delta
        ].join(',');
        const url = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${beach.lat},${beach.lon}`;
        return this.sanitizer.bypassSecurityTrustResourceUrl(url);
    }
}
