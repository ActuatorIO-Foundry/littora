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
exports.MarineController = void 0;
const common_1 = require("@nestjs/common");
const marine_service_1 = require("./marine.service");
let MarineController = class MarineController {
    constructor(marine) {
        this.marine = marine;
    }
    get(lat, lon) { return this.marine.get(Number(lat), Number(lon)); }
};
exports.MarineController = MarineController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('lat')),
    __param(1, (0, common_1.Query)('lon')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], MarineController.prototype, "get", null);
exports.MarineController = MarineController = __decorate([
    (0, common_1.Controller)('marine'),
    __metadata("design:paramtypes", [marine_service_1.MarineService])
], MarineController);
//# sourceMappingURL=marine.controller.js.map