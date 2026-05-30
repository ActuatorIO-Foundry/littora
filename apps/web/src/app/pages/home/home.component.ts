import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { Beach, BeachScore } from '../../models/beach.model';
import { LittoraApiService } from '../../services/littora-api.service';

type CoastalZone = {
    id: string;
    name: string;
    coastline: string;
    description: string;
    bbox: string;
    center: { lat: number; lon: number };
    marker: { x: number; y: number };
};

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './home.component.html',
    styleUrl: './home.component.css'
})
export class HomeComponent implements OnInit {
    beaches: Beach[] = [];
    recommendations: Array<Beach & { selectedScore?: number; scores?: BeachScore['scores'] }> = [];
    selectedBeach: Beach | null = null;
    score: BeachScore | null = null;
    selectedUsage: 'bathing' | 'family' | 'paddle' | 'boat' = 'bathing';
    lastPosition: { lat: number; lon: number; label: string; fallback?: boolean } | null = null;
    selectedZone: CoastalZone | null = null;

    loading = true;
    loadingScore = false;
    loadingRecommendations = false;
    loadingDiscovery = false;
    error = '';
    locationMessage = '';
    discoveryMessage = '';
    reportMessage = '';

    readonly coastalZones: CoastalZone[] = [
        {
            id: 'manche',
            name: 'Manche & Opale',
            coastline: 'Manche',
            description: 'Grandes marées, vent, plages familiales et navigation côtière.',
            bbox: '48.6,-5.2,51.1,2.0',
            center: { lat: 49.4, lon: -1.2 },
            marker: { x: 47, y: 18 }
        },
        {
            id: 'bretagne',
            name: 'Bretagne',
            coastline: 'Atlantique',
            description: 'Houle, criques, courants et plages exposées.',
            bbox: '47.2,-5.4,48.9,-1.0',
            center: { lat: 48.1, lon: -3.5 },
            marker: { x: 25, y: 36 }
        },
        {
            id: 'atlantique',
            name: 'Atlantique',
            coastline: 'Atlantique',
            description: 'Longues plages, houle, surf et baignade surveillée.',
            bbox: '43.0,-2.0,47.6,-0.7',
            center: { lat: 45.1, lon: -1.3 },
            marker: { x: 32, y: 64 }
        },
        {
            id: 'occitanie',
            name: 'Golfe du Lion',
            coastline: 'Méditerranée',
            description: 'Tramontane, lagunes, grandes plages et sports nautiques.',
            bbox: '42.3,2.7,43.8,4.6',
            center: { lat: 43.1, lon: 3.4 },
            marker: { x: 56, y: 83 }
        },
        {
            id: 'azur',
            name: 'Provence & Côte d’Azur',
            coastline: 'Méditerranée',
            description: 'Criques, plages urbaines, plaisance et eau chaude.',
            bbox: '42.9,4.7,43.9,7.7',
            center: { lat: 43.45, lon: 6.55 },
            marker: { x: 74, y: 79 }
        },
        {
            id: 'corse',
            name: 'Corse',
            coastline: 'Méditerranée',
            description: 'Baies, mouillages, eau claire et relief côtier.',
            bbox: '41.3,8.5,43.1,9.7',
            center: { lat: 42.15, lon: 9.1 },
            marker: { x: 87, y: 88 }
        }
    ];

    private readonly fallbackPosition = {
        lat: 43.5,
        lon: 6.7,
        label: 'Côte d’Azur',
        fallback: true
    };

    constructor(private readonly api: LittoraApiService, private readonly cdr: ChangeDetectorRef, private readonly router: Router) { }

    ngOnInit(): void {
        this.loadBeaches();
    }

    loadBeaches(): void {
        this.loading = true;
        this.error = '';
        this.locationMessage = '';
        this.beaches = [];

        this.api.getBeaches().subscribe({
            next: (beaches: Beach[]) => {
                this.beaches = [...beaches];
                this.selectedBeach = this.beaches.length > 0 ? this.beaches[0] : null;
                this.loading = false;
                this.cdr.detectChanges();

                if (this.selectedBeach) {
                    this.loadScore(this.selectedBeach);
                }
            },
            error: (err: unknown) => {
                console.error('[Littora] beaches error:', err);

                this.error = 'Impossible de charger les plages depuis l’API.';
                this.loading = false;
                this.cdr.detectChanges();
            }
        });
    }

    loadScore(beach: Beach): void {
        this.selectedBeach = beach;
        this.loadingScore = true;
        this.score = null;
        this.reportMessage = '';

        this.api.getScore(beach.id).subscribe({
            next: (score: BeachScore) => {
                this.score = score;
                this.loadingScore = false;
                this.cdr.detectChanges();
            },
            error: (err: unknown) => {
                console.error('[Littora] score error:', err);

                this.score = {
                    beach,
                    scores: {
                        bathing: 0,
                        family: 0,
                        paddle: 0,
                        boat: 0
                    },
                    error: 'Impossible de charger le score de cette plage.'
                };

                this.loadingScore = false;
                this.cdr.detectChanges();
            }
        });
    }

    useMyPosition(): void {
        if (!navigator.geolocation) {
            this.useFallbackPosition('Géolocalisation indisponible : recommandations simulées autour de la Côte d’Azur.');
            return;
        }

        this.loadingRecommendations = true;
        this.locationMessage = 'Demande de position en cours...';
        this.error = '';
        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.lastPosition = {
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                    label: 'Ma position'
                };
                this.locationMessage = 'Recommandations recalculées autour de ta position.';
                this.loadRecommendations(position.coords.latitude, position.coords.longitude);
            },
            () => {
                this.useFallbackPosition('Position refusée ou indisponible : recommandations autour de la Côte d’Azur pour la démo locale.');
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    }

    loadRecommendations(lat: number, lon: number): void {
        this.loadingRecommendations = true;
        this.error = '';
        this.api.getRecommendations(lat, lon, this.selectedUsage).subscribe({
            next: (recommendations) => {
                this.recommendations = recommendations;
                this.loadingRecommendations = false;
                this.cdr.detectChanges();
                if (recommendations[0]) {
                    this.loadScore(recommendations[0]);
                }
            },
            error: () => {
                this.loadingRecommendations = false;
                this.error = 'Impossible de calculer les recommandations autour de ta position.';
                this.cdr.detectChanges();
            }
        });
    }

    exploreZone(zone: CoastalZone): void {
        this.selectedZone = zone;
        this.lastPosition = { lat: zone.center.lat, lon: zone.center.lon, label: zone.name };
        this.discoveryMessage = `Recherche des plages ${zone.name} via OpenStreetMap...`;
        this.locationMessage = `Zone sélectionnée : ${zone.description}`;
        this.loadingDiscovery = true;
        this.loadingRecommendations = true;
        this.error = '';
        this.cdr.detectChanges();

        this.api.discoverBeaches(zone).subscribe({
            next: (result) => {
                this.beaches = result.beaches;
                this.discoveryMessage = result.warning
                    ? `${result.warning} Résultats locaux utilisés.`
                    : `${result.imported} plage(s) référencée(s) depuis ${this.discoveryProviderLabel(result.provider)}.`;
                this.loadingDiscovery = false;
                this.cdr.detectChanges();
                this.loadRecommendations(zone.center.lat, zone.center.lon);
            },
            error: () => {
                this.discoveryMessage = 'Découverte externe indisponible : résultats locaux utilisés.';
                this.loadingDiscovery = false;
                this.loadRecommendations(zone.center.lat, zone.center.lon);
            }
        });
    }

    changeUsage(usage: 'bathing' | 'family' | 'paddle' | 'boat'): void {
        this.selectedUsage = usage;
        if (this.lastPosition) {
            this.loadRecommendations(this.lastPosition.lat, this.lastPosition.lon);
            return;
        }

        this.recommendations = [];
        this.cdr.detectChanges();
    }

    resetRecommendations(): void {
        this.recommendations = [];
        this.lastPosition = null;
        this.selectedZone = null;
        this.locationMessage = '';
        this.discoveryMessage = '';
        this.error = '';
        if (this.beaches[0]) this.loadScore(this.beaches[0]);
        this.cdr.detectChanges();
    }

    openBeach(beach: Beach): void {
        this.router.navigate(['/plages', beach.id]);
    }

    signal(type: 'jellyfish' | 'pollution' | 'current' | 'crowd' | 'other'): void {
        if (!this.selectedBeach) return;

        this.api.createReport({
            beachId: this.selectedBeach.id,
            type,
            value: { source: 'web-app' },
            confidence: 0.7
        }).subscribe({
            next: () => {
                this.reportMessage = 'Signalement enregistré, merci.';
                this.cdr.detectChanges();
            },
            error: () => {
                this.reportMessage = 'Signalement indisponible pour le moment.';
                this.cdr.detectChanges();
            }
        });
    }

    metricValue(source: Record<string, unknown> | undefined, key: string, fallback = '—'): string {
        const value = source?.[key];
        if (value === null || value === undefined || value === '') return fallback;
        if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(1);
        return String(value);
    }

    metricClass(kind: 'air' | 'water' | 'uv' | 'wind' | 'wave' | 'salinity', source: Record<string, unknown> | undefined, key: string): string {
        const value = Number(source?.[key]);
        if (!Number.isFinite(value)) return 'metric-neutral';
        if (kind === 'air' || kind === 'water') {
            if (value < 20) return 'metric-blue';
            if (value < 25) return 'metric-green';
            if (value < 30) return 'metric-orange';
            return 'metric-red';
        }
        if (kind === 'uv') return value < 3 ? 'metric-green' : value < 6 ? 'metric-orange' : 'metric-red';
        if (kind === 'wind') return value < 12 ? 'metric-green' : value < 25 ? 'metric-orange' : 'metric-red';
        if (kind === 'wave') return value < 0.5 ? 'metric-green' : value < 1.2 ? 'metric-orange' : 'metric-red';
        return value >= 32 && value <= 39 ? 'metric-green' : value >= 28 ? 'metric-orange' : 'metric-blue';
    }

    flagLabel(flag?: 'green' | 'yellow' | 'red'): string {
        if (flag === 'green') return 'Drapeau vert';
        if (flag === 'yellow') return 'Drapeau jaune';
        if (flag === 'red') return 'Drapeau rouge';
        return 'Drapeau à vérifier';
    }

    usageLabel(usage = this.selectedUsage): string {
        const labels = {
            bathing: 'Baignade',
            family: 'Famille',
            paddle: 'Paddle',
            boat: 'Bateau'
        };
        return labels[usage as keyof typeof labels] ?? 'Baignade';
    }

    scoreFor(beach: Beach & { selectedScore?: number; scores?: BeachScore['scores'] }): number | null {
        if (beach.selectedScore !== undefined) return beach.selectedScore;
        return beach.scores?.[this.selectedUsage] ?? null;
    }

    providerLabel(provider?: string): string {
        if (!provider) return 'Non disponible';
        const labels: Record<string, string> = {
            'open-meteo': 'Open-Meteo Forecast API',
            'open-meteo-marine': 'Open-Meteo Marine API',
            'open-meteo-fallback': 'Open-Meteo, fallback Météo-France',
            'open-meteo-mapped': 'Météo-France à configurer, Open-Meteo actif',
            'local-weather-fallback': 'Fallback local météo',
            'local-marine-fallback': 'Fallback local marine',
            'local-tide-estimator': 'Estimateur local marées',
            'shom-spm': 'SHOM SUP/SAPM',
            'local-cache': 'Cache local qualité eau',
            'baignades-sante/data-gouv-ready': 'ARS / data.gouv à ingérer'
        };
        return labels[provider] ?? provider;
    }

    timeLabel(value: unknown): string {
        if (!value) return 'Non disponible';
        const date = new Date(String(value));
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    discoveryProviderLabel(provider?: string): string {
        if (provider === 'openstreetmap-overpass') return 'OpenStreetMap / Overpass';
        if (provider === 'openstreetmap-nominatim') return 'OpenStreetMap / Nominatim';
        if (provider === 'openstreetmap-cache') return 'OpenStreetMap / cache Redis';
        if (provider === 'local-db-fallback') return 'la base locale';
        return provider ?? 'source inconnue';
    }

    private useFallbackPosition(message: string): void {
        this.lastPosition = this.fallbackPosition;
        this.locationMessage = message;
        this.loadRecommendations(this.fallbackPosition.lat, this.fallbackPosition.lon);
    }

    trackByBeachId(index: number, beach: Beach): string {
        return beach.id;
    }
}
