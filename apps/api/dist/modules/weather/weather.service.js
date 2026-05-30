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
exports.WeatherService = void 0;
const common_1 = require("@nestjs/common");
const cache_service_1 = require("../../cache/cache.service");
const http_1 = require("../../shared/http");
const weatherKeys = [
    'temperature_2m',
    'apparent_temperature',
    'relative_humidity_2m',
    'precipitation',
    'cloud_cover',
    'wind_speed_10m',
    'wind_gusts_10m',
    'wind_direction_10m',
    'uv_index',
];
let WeatherService = class WeatherService {
    constructor(cache) {
        this.cache = cache;
    }
    async get(lat, lon) {
        const provider = process.env.WEATHER_PROVIDER || 'openmeteo';
        return provider === 'meteofrance' ? this.getMeteoFrance(lat, lon) : this.getOpenMeteo(lat, lon);
    }
    async getOpenMeteo(lat, lon) {
        const cacheKey = `weather:openmeteo:${lat.toFixed(3)}:${lon.toFixed(3)}`;
        const cached = await this.cache.getJson(cacheKey);
        if (cached)
            return cached;
        try {
            const hourly = weatherKeys.join(',');
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${hourly}&forecast_days=3&timezone=auto`;
            const raw = await (0, http_1.fetchJson)(url);
            const payload = {
                provider: 'open-meteo',
                raw,
                current: this.pickNearest(raw.hourly, weatherKeys),
            };
            await this.cache.setJson(cacheKey, payload, 900);
            return payload;
        }
        catch (error) {
            return {
                provider: 'local-weather-fallback',
                warning: error instanceof Error ? error.message : 'Open-Meteo unavailable',
                current: this.estimate(lat, lon),
            };
        }
    }
    async getMeteoFrance(lat, lon) {
        const key = process.env.METEOFRANCE_API_KEY;
        if (!key) {
            return {
                ...(await this.getOpenMeteo(lat, lon)),
                provider: 'open-meteo-fallback',
                warning: 'METEOFRANCE_API_KEY missing',
            };
        }
        return {
            ...(await this.getOpenMeteo(lat, lon)),
            provider: 'open-meteo-mapped',
            warning: 'Meteo-France key detected. Configure the chosen forecast/vigilance product endpoint before replacing Open-Meteo mapping.',
        };
    }
    pickNearest(hourly, keys) {
        const times = Array.isArray(hourly?.time) ? hourly.time : [];
        const now = Date.now();
        const index = times.reduce((best, time, currentIndex) => {
            const delta = Math.abs(new Date(time).getTime() - now);
            const bestDelta = Math.abs(new Date(times[best] ?? 0).getTime() - now);
            return delta < bestDelta ? currentIndex : best;
        }, 0);
        const out = { time: times[index] ?? new Date().toISOString() };
        for (const key of keys)
            out[key] = hourly?.[key]?.[index] ?? null;
        return out;
    }
    estimate(lat, lon) {
        const month = new Date().getMonth();
        const mediterranean = lon > 3 && lat < 45;
        const summerBoost = Math.max(0, Math.sin(((month + 1) / 12) * Math.PI));
        return {
            time: new Date().toISOString(),
            temperature_2m: Number((13 + summerBoost * 16 + (mediterranean ? 2 : 0)).toFixed(1)),
            apparent_temperature: Number((13 + summerBoost * 16 + (mediterranean ? 2 : 0)).toFixed(1)),
            relative_humidity_2m: mediterranean ? 62 : 72,
            precipitation: 0,
            cloud_cover: mediterranean ? 24 : 48,
            wind_speed_10m: mediterranean ? 13 : 18,
            wind_gusts_10m: mediterranean ? 24 : 32,
            wind_direction_10m: mediterranean ? 145 : 260,
            uv_index: Number((2 + summerBoost * 6).toFixed(1)),
        };
    }
};
exports.WeatherService = WeatherService;
exports.WeatherService = WeatherService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [cache_service_1.CacheService])
], WeatherService);
//# sourceMappingURL=weather.service.js.map