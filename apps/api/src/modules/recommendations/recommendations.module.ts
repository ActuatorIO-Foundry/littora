import { Module } from '@nestjs/common';
import { BeachesModule } from '../beaches/beaches.module';
import { ReportsModule } from '../reports/reports.module';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

@Module({imports:[BeachesModule,ReportsModule],controllers:[RecommendationsController],providers:[RecommendationsService]})
export class RecommendationsModule {}
