import { Module } from '@nestjs/common';
import { BeachesController } from './beaches.controller';
import { BeachesService } from './beaches.service';
import { AmenitiesService } from './amenities.service';
@Module({ controllers: [BeachesController], providers: [BeachesService, AmenitiesService], exports: [BeachesService, AmenitiesService] })
export class BeachesModule {}
