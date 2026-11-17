import { Module } from '@nestjs/common';
import { WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';
import { ForecastStore } from '../../shared/forecast-store';
@Module({ controllers: [WeatherController], providers: [WeatherService, ForecastStore], exports: [WeatherService] })
export class WeatherModule {}
