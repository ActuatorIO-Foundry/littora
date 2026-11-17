import { Module } from '@nestjs/common';
import { MarineController } from './marine.controller';
import { MarineService } from './marine.service';
import { ForecastStore } from '../../shared/forecast-store';
@Module({ controllers: [MarineController], providers: [MarineService, ForecastStore], exports: [MarineService] })
export class MarineModule {}
