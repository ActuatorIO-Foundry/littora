"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaterQualityModule = void 0;
const common_1 = require("@nestjs/common");
const water_quality_service_1 = require("./water-quality.service");
const water_quality_controller_1 = require("./water-quality.controller");
let WaterQualityModule = class WaterQualityModule {
};
exports.WaterQualityModule = WaterQualityModule;
exports.WaterQualityModule = WaterQualityModule = __decorate([
    (0, common_1.Module)({ providers: [water_quality_service_1.WaterQualityService], controllers: [water_quality_controller_1.WaterQualityController], exports: [water_quality_service_1.WaterQualityService] })
], WaterQualityModule);
//# sourceMappingURL=water-quality.module.js.map