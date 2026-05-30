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
exports.IngestionService = void 0;
const common_1 = require("@nestjs/common");
const jobs_service_1 = require("../../jobs/jobs.service");
let IngestionService = class IngestionService {
    constructor(jobs) {
        this.jobs = jobs;
    }
    async waterQuality() {
        const sourceUrl = process.env.WATER_QUALITY_DATASET_URL;
        if (!sourceUrl) {
            return {
                ok: true,
                queued: false,
                warning: 'Set WATER_QUALITY_DATASET_URL to an official CSV/JSON resource, then run this endpoint again.',
            };
        }
        return this.jobs.enqueueWaterQuality(sourceUrl);
    }
};
exports.IngestionService = IngestionService;
exports.IngestionService = IngestionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [jobs_service_1.JobsService])
], IngestionService);
//# sourceMappingURL=ingestion.service.js.map