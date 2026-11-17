import { Module } from '@nestjs/common';
import { BeachesModule } from '../beaches/beaches.module';
import { PlacesModule } from '../places/places.module';
import { ReportsModule } from '../reports/reports.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({ imports: [BeachesModule, PlacesModule, ReportsModule],
  controllers: [SearchController], providers: [SearchService] })
export class SearchModule {}
