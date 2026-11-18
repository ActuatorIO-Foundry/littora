import { Controller, Get, Param, Query } from '@nestjs/common';
import { BeachesService } from './beaches.service';
@Controller('beaches')
export class BeachesController {
  constructor(private s: BeachesService) {}

  @Get()
  list(@Query('lat') lat?: string, @Query('lon') lon?: string, @Query('limit') limit?: string) {
    return this.s.list(lat ? +lat : undefined, lon ? +lon : undefined, limit ? +limit : 180);
  }

  @Get('discover')
  discover(
    @Query('bbox') bbox: string,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ) {
    return this.s.discover(bbox, limit ? +limit : 140, after);
  }

  @Get('catalogue')
  catalogue(@Query('after') after?: string, @Query('limit') limit?: string, @Query('bbox') bbox?: string) {
    return this.s.catalogue(after, limit === undefined ? 200 : Number(limit), bbox);
  }

  @Get(':id/amenities')
  amenities(@Param('id') id: string) {
    return this.s.nearbyAmenities(id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.s.get(id);
  }
}
