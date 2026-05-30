"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoreService = void 0;
const common_1 = require("@nestjs/common");
const beaches_service_1 = require("../beaches/beaches.service");
const marine_service_1 = require("../marine/marine.service");
const reports_service_1 = require("../reports/reports.service");
const tides_service_1 = require("../tides/tides.service");
const water_quality_service_1 = require("../water-quality/water-quality.service");
const weather_service_1 = require("../weather/weather.service");
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
let ScoreService = class ScoreService {
    constructor(beaches, weather, marine, tides, water, reports) {
        this.beaches = beaches;
        this.weather = weather;
        this.marine = marine;
        this.tides = tides;
        this.water = water;
        this.reports = reports;
    }
    async scoreBeach(id) {
        const beach = await this.beaches.get(id);
        const [weather, marine, tides, waterQuality, community] = await Promise.all([
            this.weather.get(beach.lat, beach.lon),
            this.marine.get(beach.lat, beach.lon),
            this.tides.get(beach.lat, beach.lon),
            this.water.get(id, beach.lat, beach.lon),
            this.reports.aggregate(id),
        ]);
        const wc = weather.current;
        const mc = marine.current;
        const wind = Number(wc.wind_speed_10m ?? 0);
        const gust = Number(wc.wind_gusts_10m ?? 0);
        const uv = Number(wc.uv_index ?? 0);
        const wave = Number(mc.wave_height ?? 0);
        const current = Number(mc.ocean_current_velocity ?? 0);
        const waterTemp = Number(mc.sea_surface_temperature ?? 22);
        const communityPenalty = this.communityPenalty(community);
        const qualityBonus = waterQuality.status === 'excellent' ? 10 : waterQuality.status === 'good' ? 5 : waterQuality.status === 'poor' ? -35 : 0;
        const bathing = clamp(92 - wind * 1.3 - gust * 0.6 - uv * 2.2 - wave * 18 - current * 40 - Math.abs(24 - waterTemp) * 2 + qualityBonus - communityPenalty.bathing);
        const family = clamp(bathing - uv * 1.5 - wave * 10 + (beach.has_lifeguard ? 6 : -8) + (beach.has_toilets ? 3 : 0) + (beach.has_parking ? 3 : 0) - communityPenalty.family);
        const paddle = clamp(88 - wind * 2.2 - gust * 0.8 - wave * 24 - current * 60 - communityPenalty.paddle);
        const boat = clamp(84 - wind * 1.1 - gust * 0.9 - wave * 22 - current * 35 - communityPenalty.boat);
        return {
            beach,
            current: { weather: wc, marine: mc, tides, waterQuality, community },
            scores: { bathing, family, paddle, boat },
            safety: this.safety(bathing, wave, current, uv, wind, waterQuality.status, communityPenalty.alerts),
            summary: this.summary(bathing, family, paddle, boat),
            forecast: {
                uv: this.series(weather.raw?.hourly, 'uv_index'),
                air: this.series(weather.raw?.hourly, 'temperature_2m'),
                water: this.series(marine.raw?.hourly, 'sea_surface_temperature'),
                wave: this.series(marine.raw?.hourly, 'wave_height'),
            },
            reliability: {
                weather: weather.provider.includes('fallback') ? 'medium' : 'high',
                marine: marine.provider.includes('fallback') ? 'medium' : 'high',
                tides: tides.reliability ?? 'medium',
                waterQuality: waterQuality.reliability ?? 'medium',
                community: community.length ? 'fresh' : 'none',
            },
            providers: {
                weather: weather.provider,
                marine: marine.provider,
                tides: tides.provider,
                waterQuality: waterQuality.provider,
                community: 'littora-reports',
            },
            disclaimer: 'Scores indicatifs. Ne remplacent jamais les consignes officielles, drapeaux, postes de secours, BMS ou autorités locales.',
        };
    }
    safety(bathing, wave, current, uv, wind, quality, communityAlerts = []) {
        const flag = bathing >= 78 && wave < 0.8 && current < 0.18 ? 'green' : bathing >= 55 && wave < 1.3 && current < 0.32 ? 'yellow' : 'red';
        return {
            flag,
            source: 'Estimation Littora: météo, vagues, courant, UV, qualité d’eau et signalements. Le drapeau officiel reste celui affiché sur place.',
            official: false,
            alerts: [
                ...(uv >= 7 ? ['UV élevé'] : []),
                ...(wind >= 28 ? ['Vent soutenu'] : []),
                ...(wave >= 1.2 ? ['Mer agitée'] : []),
                ...(current >= 0.28 ? ['Courant marqué'] : []),
                ...(quality === 'poor' ? ['Qualité d’eau défavorable'] : []),
                ...communityAlerts,
            ],
        };
    }
    summary(bathing, family, paddle, boat) {
        return {
            bathing: bathing > 80 ? 'Excellente baignade probable' : bathing > 60 ? 'Baignade correcte avec vigilance' : 'Baignade défavorable ou incertaine',
            family: family > 75 ? 'Adaptée famille' : 'À vérifier pour famille',
            paddle: paddle > 75 ? 'Bon créneau paddle' : 'Paddle à éviter si vent/courant augmente',
            boat: boat > 75 ? 'Sortie bateau favorable' : 'Navigation à préparer avec prudence',
        };
    }
    series(hourly, key) {
        const times = Array.isArray(hourly?.time) ? hourly?.time : [];
        const values = Array.isArray(hourly?.[key]) ? hourly?.[key] : [];
        const now = Date.now();
        const first = times.findIndex((time) => new Date(time).getTime() >= now);
        const start = first >= 0 ? first : 0;
        return times
            .slice(start, start + 8)
            .map((time, index) => ({ time, value: Number(values[start + index]) }))
            .filter((point) => Number.isFinite(point.value));
    }
    communityPenalty(reports) {
        const penalty = { bathing: 0, family: 0, paddle: 0, boat: 0, alerts: [] };
        for (const report of reports) {
            const weight = Math.min(1, Number(report.count) * Number(report.confidence ?? 0.5));
            if (report.type === 'jellyfish') {
                penalty.bathing += 12 * weight;
                penalty.family += 10 * weight;
                penalty.alerts.push('Signalements méduses');
            }
            if (report.type === 'current') {
                penalty.bathing += 10 * weight;
                penalty.paddle += 14 * weight;
                penalty.boat += 7 * weight;
                penalty.alerts.push('Signalements courant');
            }
            if (report.type === 'pollution') {
                penalty.bathing += 22 * weight;
                penalty.family += 18 * weight;
                penalty.alerts.push('Signalements pollution');
            }
            if (report.type === 'crowd') {
                penalty.family += 6 * weight;
                penalty.alerts.push('Affluence signalée');
            }
        }
        penalty.alerts = Array.from(new Set(penalty.alerts));
        return penalty;
    }
};
exports.ScoreService = ScoreService;
exports.ScoreService = ScoreService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [beaches_service_1.BeachesService,
        weather_service_1.WeatherService,
        marine_service_1.MarineService,
        tides_service_1.TidesService,
        water_quality_service_1.WaterQualityService,
        reports_service_1.ReportsService])
], ScoreService);
//# sourceMappingURL=score.service.js.map