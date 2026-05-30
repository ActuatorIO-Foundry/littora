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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaterQualityService = void 0;
const common_1 = require("@nestjs/common");
const database_module_1 = require("../../database/database.module");
let WaterQualityService = class WaterQualityService {
    constructor(db) {
        this.db = db;
    }
    async get(beachId, lat, lon) { if (beachId) {
        const { rows } = await this.db.query('select * from water_quality where beach_id=$1 order by sample_date desc limit 1', [beachId]);
        if (rows[0])
            return { ...rows[0], provider: 'local-cache' };
    } return { provider: 'baignades-sante/data-gouv-ready', status: 'unknown', classification: null, reliability: 'pending', warning: 'Import the official bathing-water dataset URL into WATER_QUALITY_DATASET_URL, then run ingestion.' }; }
};
exports.WaterQualityService = WaterQualityService;
exports.WaterQualityService = WaterQualityService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.PG)),
    __metadata("design:paramtypes", [Object])
], WaterQualityService);
//# sourceMappingURL=water-quality.service.js.map