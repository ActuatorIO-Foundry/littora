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
exports.ReportsService = void 0;
const common_1 = require("@nestjs/common");
const database_module_1 = require("../../database/database.module");
let ReportsService = class ReportsService {
    constructor(db) {
        this.db = db;
    }
    async create(dto) { const { rows } = await this.db.query('insert into reports(beach_id,type,value,confidence) values($1,$2,$3,$4) returning *', [dto.beachId, dto.type, dto.value ?? {}, dto.confidence ?? 0.5]); return rows[0]; }
    async list(beachId) { const { rows } = await this.db.query('select * from reports where beach_id=$1 order by created_at desc limit 50', [beachId]); return rows; }
    async aggregate(beachId) { const { rows } = await this.db.query(`select type,count(*)::int as count,avg(confidence)::float as confidence from reports where beach_id=$1 and status in ('pending','verified') and created_at > now() - interval '24 hours' group by type`, [beachId]); return rows; }
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.PG)),
    __metadata("design:paramtypes", [Object])
], ReportsService);
//# sourceMappingURL=reports.service.js.map