import { Controller, Get, Query } from '@nestjs/common';
import { MarineService } from './marine.service';
@Controller('marine')
export class MarineController {
  constructor(private readonly marine: MarineService) {}
  @Get()
  get(@Query('lat') lat: string, @Query('lon') lon: string) { return this.marine.get(Number(lat), Number(lon)); }
}
