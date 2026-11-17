import { Controller, Get, Param, Query } from '@nestjs/common';
import { PlacesService } from './places.service';

@Controller('places/communes')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}
  @Get()
  search(@Query('q') query = '') { return this.places.search(query); }
  @Get(':code/beaches')
  catalogue(@Param('code') code: string) { return this.places.catalogue(code); }
}
