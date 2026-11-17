import { BadRequestException } from '@nestjs/common';

export interface ReportInput {
  beachId: string;
  type: 'jellyfish' | 'pollution' | 'current' | 'crowd' | 'flag' | 'other';
  value?: Record<string,string>;
  observedAt?: string;
  confidence?: number;
}

export function normalizeReport(dto: ReportInput, now = Date.now()) {
  const observed = dto.observedAt === undefined ? now : Date.parse(dto.observedAt);
  if (!Number.isFinite(observed) || observed > now + 30_000 || observed <= now - 24 * 3600_000) throw new BadRequestException();
  const value = { ...dto.value };
  delete value.source;
  if (dto.type === 'flag') {
    const aliases: Record<string,string> = { green:'green',vert:'green',verte:'green',yellow:'yellow',jaune:'yellow',orange:'yellow',red:'red',rouge:'red' };
    const flags = [value.flag,value.drapeau,value.value].filter(v=>v!==undefined).map(v=>aliases[v]);
    if (!flags.length || flags.some(v=>!v) || new Set(flags).size!==1) throw new BadRequestException();
    delete value.drapeau; delete value.value;
    value.flag=flags[0];
  } else if (value.flag!==undefined || value.drapeau!==undefined) throw new BadRequestException();
  if (value.severity && !['low','medium','high'].includes(value.severity)) throw new BadRequestException();
  if (dto.type==='other' && !value.note?.trim()) throw new BadRequestException();
  return { beachId:dto.beachId,type:dto.type,value,observedAt:new Date(Math.min(now,observed)).toISOString() };
}
