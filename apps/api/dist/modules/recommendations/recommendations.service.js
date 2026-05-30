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
exports.RecommendationsService = void 0;
const common_1 = require("@nestjs/common");
const beaches_service_1 = require("../beaches/beaches.service");
const score_service_1 = require("../score/score.service");
const allowedUsages = ['bathing', 'family', 'paddle', 'boat'];
let RecommendationsService = class RecommendationsService {
    constructor(beaches, scores) {
        this.beaches = beaches;
        this.scores = scores;
    }
    async best(lat, lon, usage = 'bathing') {
        const selectedUsage = allowedUsages.includes(usage) ? usage : 'bathing';
        const beaches = await this.beaches.list(lat, lon, 30);
        const enriched = [];
        for (const beach of beaches) {
            try {
                const score = await this.scores.scoreBeach(beach.id);
                enriched.push({
                    ...beach,
                    scores: score.scores,
                    selectedScore: score.scores[selectedUsage] ?? score.scores.bathing,
                });
            }
            catch {
            }
        }
        return enriched.sort((a, b) => b.selectedScore - a.selectedScore);
    }
};
exports.RecommendationsService = RecommendationsService;
exports.RecommendationsService = RecommendationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [beaches_service_1.BeachesService,
        score_service_1.ScoreService])
], RecommendationsService);
//# sourceMappingURL=recommendations.service.js.map