import { Controller, Get, Header, Query } from '@nestjs/common';
import { TidesService } from './tides.service';

@Controller('tides')
export class TidesController {
  constructor(private readonly service:TidesService) {}
  @Get()
  @Header('Cache-Control','no-store')
  get(@Query('lat') lat:string,@Query('lon') lon:string,@Query('harbor') harbor?:string) {
    return this.service.get(+lat,+lon,harbor);
  }
}
