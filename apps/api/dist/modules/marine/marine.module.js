"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarineModule = void 0;
const common_1 = require("@nestjs/common");
const marine_controller_1 = require("./marine.controller");
const marine_service_1 = require("./marine.service");
let MarineModule = class MarineModule {
};
exports.MarineModule = MarineModule;
exports.MarineModule = MarineModule = __decorate([
    (0, common_1.Module)({ controllers: [marine_controller_1.MarineController], providers: [marine_service_1.MarineService], exports: [marine_service_1.MarineService] })
], MarineModule);
//# sourceMappingURL=marine.module.js.map