import { Injectable } from '@nestjs/common';
import { BeachesService } from '../beaches/beaches.service';
import { MarineService } from '../marine/marine.service';
import { ReportsService } from '../reports/reports.service';
import { TidesService } from '../tides/tides.service';
import { WaterQualityService } from '../water-quality/water-quality.service';
import { WeatherService } from '../weather/weather.service';
import { finiteMetric } from '../../shared/forecast-data';

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

@Injectable()
export class ScoreService {
  constructor(
    private beaches: BeachesService,
    private weather: WeatherService,
    private marine: MarineService,
    private tides: TidesService,
    private water: WaterQualityService,
    private reports: ReportsService,
  ) {}

  async scoreBeach(id: string) {
    const beach = await this.beaches.get(id);
    const [weather, marine, tides, waterQuality, community, flagConsensus] = await Promise.all([
      this.weather.get(beach.lat, beach.lon),
      this.marine.get(beach.lat, beach.lon),
      this.tides.get(beach.lat, beach.lon),
      this.water.get(id, beach.lat, beach.lon),
      this.reports.aggregate(id),
      this.reports.flagConsensus(id),
    ]);

    const wc = weather.current;
    const mc = marine.current;
    const wind = finiteMetric(wc.wind_speed_10m);
    const gust = finiteMetric(wc.wind_gusts_10m);
    const uv = finiteMetric(wc.uv_index);
    const wave = finiteMetric(mc.wave_height);
    const current = finiteMetric(mc.ocean_current_velocity);
    const waterTemp = finiteMetric(mc.sea_surface_temperature);
    const communityPenalty = this.communityPenalty(community);
    const qualityStatus = waterQuality.is_demo || waterQuality.raw?.demo === true || waterQuality.raw?.demo === 'true' ||
      ['local-seed', 'demo-seed'].includes(waterQuality.source) ? 'unknown' : waterQuality.status;
    const qualityBonus = qualityStatus === 'excellent' ? 10 : qualityStatus === 'good' ? 5 : qualityStatus === 'poor' ? -35 : 0;

    const fresh = ![weather.status, marine.status].some(s => s === 'unknown' || s === 'stale');
    const bathing = fresh && wind !== null && gust !== null && uv !== null && wave !== null && current !== null && waterTemp !== null
      ? clamp(92 - wind * 1.3 - gust * 0.6 - uv * 2.2 - wave * 18 - current * 40 - Math.abs(24 - waterTemp) * 2 + qualityBonus - communityPenalty.bathing) : null;
    const family = bathing !== null && uv !== null && wave !== null
      ? clamp(bathing - uv * 1.5 - wave * 10 + (beach.has_lifeguard ? 6 : -8) + (beach.has_toilets ? 3 : 0) + (beach.has_parking ? 3 : 0) - communityPenalty.family) : null;
    const paddle = fresh && wind !== null && gust !== null && wave !== null && current !== null
      ? clamp(88 - wind * 2.2 - gust * 0.8 - wave * 24 - current * 60 - communityPenalty.paddle) : null;
    const boat = fresh && wind !== null && gust !== null && wave !== null && current !== null
      ? clamp(84 - wind * 1.1 - gust * 0.9 - wave * 22 - current * 35 - communityPenalty.boat) : null;

    return {
      beach,
      current: { weather: wc, marine: mc, tides, waterQuality, community },
      scores: { bathing, family, paddle, boat },
      safety: this.safety(bathing, fresh ? wave : null, fresh ? current : null, fresh ? uv : null, fresh ? wind : null, qualityStatus, communityPenalty.alerts, flagConsensus),
      summary: this.summary(bathing, family, paddle, boat),
      forecast: {
        uv: this.series(weather.raw?.hourly, 'uv_index'),
        air: this.series(weather.raw?.hourly, 'temperature_2m'),
        water: this.series(marine.raw?.hourly, 'sea_surface_temperature'),
        wave: this.series(marine.raw?.hourly, 'wave_height'),
        current: this.series(marine.raw?.hourly, 'ocean_current_velocity'),
      },
      reliability: {
        weather: weather.status ?? 'unknown',
        marine: marine.status ?? 'unknown',
        tides: tides.reliability ?? 'medium',
        waterQuality: waterQuality.reliability ?? 'medium',
        community: community.length || flagConsensus ? 'fresh' : 'none',
      },
      dataStatus: { weather: this.dataStatus(weather), marine: this.dataStatus(marine) },
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

  safety(bathing: number | null, wave: number | null, current: number | null, uv: number | null, wind: number | null, quality?: string, communityAlerts: string[] = [], communityFlag?: any) {
    const estimatedFlag = bathing === null || wave === null || current === null ? 'unknown'
      : bathing >= 78 && wave < 0.8 && current < 0.18 ? 'green' : bathing >= 55 && wave < 1.3 && current < 0.32 ? 'yellow' : 'red';
    const flag = communityFlag?.confidence >= 0.58 ? communityFlag.flag : estimatedFlag;
    return {
      flag,
      source: communityFlag?.confidence >= 0.58
        ? `Consensus communautaire récent (${Math.round(communityFlag.confidence * 100)}%) croisé avec météo/mer. Le drapeau officiel reste celui affiché sur place.`
        : estimatedFlag === 'unknown' ? 'Conditions insuffisantes. Le drapeau officiel reste celui affiché sur place.'
          : 'Estimation Littora: météo, vagues, courant, UV, qualité d’eau et signalements. Le drapeau officiel reste celui affiché sur place.',
      official: false,
      communityFlag: communityFlag ?? null,
      alerts: [
        ...(uv !== null && uv >= 7 ? ['UV élevé'] : []),
        ...(wind !== null && wind >= 28 ? ['Vent soutenu'] : []),
        ...(wave !== null && wave >= 1.2 ? ['Mer agitée'] : []),
        ...(current !== null && current >= 0.28 ? ['Courant marqué'] : []),
        ...(quality === 'poor' ? ['Qualité d’eau défavorable'] : []),
        ...(communityFlag ? [`Drapeaux signalés: ${communityFlag.counts.green} vert, ${communityFlag.counts.yellow} jaune, ${communityFlag.counts.red} rouge`] : []),
        ...communityAlerts,
      ],
    };
  }

  summary(bathing: number | null, family: number | null, paddle: number | null, boat: number | null) {
    return {
      bathing: bathing === null ? 'Données insuffisantes' : bathing > 80 ? 'Excellente baignade probable' : bathing > 60 ? 'Baignade correcte avec vigilance' : 'Baignade défavorable ou incertaine',
      family: family === null ? 'Données insuffisantes' : family > 75 ? 'Adaptée famille' : 'À vérifier pour famille',
      paddle: paddle === null ? 'Données insuffisantes' : paddle > 75 ? 'Bon créneau paddle' : 'Paddle à éviter si vent/courant augmente',
      boat: boat === null ? 'Données insuffisantes' : boat > 75 ? 'Sortie bateau favorable' : 'Navigation à préparer avec prudence',
    };
  }

  private series(hourly: Record<string, any[]> | undefined, key: string) {
    const times = Array.isArray(hourly?.time) ? hourly?.time : [];
    const values = Array.isArray(hourly?.[key]) ? hourly?.[key] : [];
    const now = Date.now();
    const first = times.findIndex((time) => new Date(time).getTime() >= now);
    if (first < 0) return [];
    const start = first;

    return times
      .slice(start, start + 8)
      .map((time, index) => ({ time, value: finiteMetric(values[start + index]) }))
      .filter((point) => point.time && Number.isFinite(Date.parse(point.time)));
  }

  private dataStatus(data: any) {
    return { status: data.status ?? 'unknown', kind: data.kind ?? null,
      fetchedAt: data.fetchedAt ?? null, validAt: data.validAt ?? null,
      ageSeconds: data.ageSeconds ?? null, producedAt: data.producedAt ?? null,
      units: data.units ?? {}, provider: data.provider, warning: data.warning ?? null };
  }

  private communityPenalty(reports: Array<{ type: string; count: number; confidence: number }>) {
    const penalty = { bathing: 0, family: 0, paddle: 0, boat: 0, alerts: [] as string[] };

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
}
