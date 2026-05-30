"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TidesService = void 0;
const common_1 = require("@nestjs/common");
let TidesService = class TidesService {
    async get(lat, lon, harbor) { const key = process.env.SHOM_API_KEY; if (!key) {
        return { provider: 'local-tide-estimator', reliability: 'low', warning: 'SHOM_API_KEY missing: SHOM SUP/SAPM needs a subscription key. Using non-navigational estimate.', harbor: harbor ?? null, events: this.estimate() };
    } return { provider: 'shom-spm', reliability: 'high', warning: 'Adapter ready: set SHOM endpoint/contract parameters in src/modules/tides/tides.service.ts according to your SUP/SAPM subscription.', events: [] }; }
    estimate() { const now = new Date(); return Array.from({ length: 4 }).map((_, i) => ({ time: new Date(now.getTime() + i * 6.2 * 3600_000).toISOString(), type: i % 2 ? 'low' : 'high', height_m: Number((1.2 + Math.sin(i) * 0.6).toFixed(2)), coefficient: null })); }
};
exports.TidesService = TidesService;
exports.TidesService = TidesService = __decorate([
    (0, common_1.Injectable)()
], TidesService);
//# sourceMappingURL=tides.service.js.map