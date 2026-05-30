"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoreModule = void 0;
const common_1 = require("@nestjs/common");
const score_controller_1 = require("./score.controller");
const score_service_1 = require("./score.service");
const beaches_module_1 = require("../beaches/beaches.module");
const weather_module_1 = require("../weather/weather.module");
const marine_module_1 = require("../marine/marine.module");
const tides_module_1 = require("../tides/tides.module");
const water_quality_module_1 = require("../water-quality/water-quality.module");
const reports_module_1 = require("../reports/reports.module");
let ScoreModule = class ScoreModule {
};
exports.ScoreModule = ScoreModule;
exports.ScoreModule = ScoreModule = __decorate([
    (0, common_1.Module)({ imports: [beaches_module_1.BeachesModule, weather_module_1.WeatherModule, marine_module_1.MarineModule, tides_module_1.TidesModule, water_quality_module_1.WaterQualityModule, reports_module_1.ReportsModule], controllers: [score_controller_1.ScoreController], providers: [score_service_1.ScoreService], exports: [score_service_1.ScoreService] })
], ScoreModule);
//# sourceMappingURL=score.module.js.map