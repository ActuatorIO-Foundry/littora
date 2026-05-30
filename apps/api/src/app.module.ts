import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from './cache/cache.module';
import { DatabaseModule } from './database/database.module';
import { JobsModule } from './jobs/jobs.module';
import { BeachesModule } from './modules/beaches/beaches.module';
import { WeatherModule } from './modules/weather/weather.module';
import { MarineModule } from './modules/marine/marine.module';
import { ScoreModule } from './modules/score/score.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TidesModule } from './modules/tides/tides.module';
import { WaterQualityModule } from './modules/water-quality/water-quality.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { AuthModule } from './modules/auth/auth.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { AdminModule } from './modules/admin/admin.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
@Module({imports:[ConfigModule.forRoot({isGlobal:true}),ScheduleModule.forRoot(),CacheModule,JobsModule,DatabaseModule,BeachesModule,WeatherModule,MarineModule,TidesModule,WaterQualityModule,AlertsModule,ReportsModule,ScoreModule,RecommendationsModule,AuthModule,FavoritesModule,AdminModule,IngestionModule]})
export class AppModule {}
