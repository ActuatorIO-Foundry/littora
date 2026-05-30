"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const schedule_1 = require("@nestjs/schedule");
const cache_module_1 = require("./cache/cache.module");
const database_module_1 = require("./database/database.module");
const jobs_module_1 = require("./jobs/jobs.module");
const beaches_module_1 = require("./modules/beaches/beaches.module");
const weather_module_1 = require("./modules/weather/weather.module");
const marine_module_1 = require("./modules/marine/marine.module");
const score_module_1 = require("./modules/score/score.module");
const reports_module_1 = require("./modules/reports/reports.module");
const tides_module_1 = require("./modules/tides/tides.module");
const water_quality_module_1 = require("./modules/water-quality/water-quality.module");
const alerts_module_1 = require("./modules/alerts/alerts.module");
const recommendations_module_1 = require("./modules/recommendations/recommendations.module");
const auth_module_1 = require("./modules/auth/auth.module");
const favorites_module_1 = require("./modules/favorites/favorites.module");
const admin_module_1 = require("./modules/admin/admin.module");
const ingestion_module_1 = require("./modules/ingestion/ingestion.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({ imports: [config_1.ConfigModule.forRoot({ isGlobal: true }), schedule_1.ScheduleModule.forRoot(), cache_module_1.CacheModule, jobs_module_1.JobsModule, database_module_1.DatabaseModule, beaches_module_1.BeachesModule, weather_module_1.WeatherModule, marine_module_1.MarineModule, tides_module_1.TidesModule, water_quality_module_1.WaterQualityModule, alerts_module_1.AlertsModule, reports_module_1.ReportsModule, score_module_1.ScoreModule, recommendations_module_1.RecommendationsModule, auth_module_1.AuthModule, favorites_module_1.FavoritesModule, admin_module_1.AdminModule, ingestion_module_1.IngestionModule] })
], AppModule);
//# sourceMappingURL=app.module.js.map