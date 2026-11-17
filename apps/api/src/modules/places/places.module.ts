import { Module } from '@nestjs/common';
import { BeachesModule } from '../beaches/beaches.module';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';

@Module({ imports: [BeachesModule], controllers: [PlacesController], providers: [PlacesService] })
export class PlacesModule {}
