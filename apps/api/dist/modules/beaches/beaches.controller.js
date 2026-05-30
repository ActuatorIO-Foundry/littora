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
exports.BeachesController = void 0;
const common_1 = require("@nestjs/common");
const beaches_service_1 = require("./beaches.service");
let BeachesController = class BeachesController {
    constructor(s) {
        this.s = s;
    }
    list(lat, lon, limit) {
        return this.s.list(lat ? +lat : undefined, lon ? +lon : undefined, limit ? +limit : 180);
    }
    discover(bbox, region = 'France littorale', coastline = 'Littoral', limit) {
        return this.s.discoverFromOpenStreetMap(bbox, region, coastline, limit ? +limit : 140);
    }
    amenities(id) {
        return this.s.nearbyAmenities(id);
    }
    get(id) {
        return this.s.get(id);
    }
};
exports.BeachesController = BeachesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('lat')),
    __param(1, (0, common_1.Query)('lon')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], BeachesController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('discover'),
    __param(0, (0, common_1.Query)('bbox')),
    __param(1, (0, common_1.Query)('region')),
    __param(2, (0, common_1.Query)('coastline')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object, String]),
    __metadata("design:returntype", void 0)
], BeachesController.prototype, "discover", null);
__decorate([
    (0, common_1.Get)(':id/amenities'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BeachesController.prototype, "amenities", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BeachesController.prototype, "get", null);
exports.BeachesController = BeachesController = __decorate([
    (0, common_1.Controller)('beaches'),
    __metadata("design:paramtypes", [beaches_service_1.BeachesService])
], BeachesController);
//# sourceMappingURL=beaches.controller.js.map