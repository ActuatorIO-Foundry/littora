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
    @Query('region') region = 'France littorale',
    @Query('coastline') coastline = 'Littoral',
    @Query('limit') limit?: string,
  ) {
    return this.s.discoverFromOpenStreetMap(bbox, region, coastline, limit ? +limit : 140);
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
