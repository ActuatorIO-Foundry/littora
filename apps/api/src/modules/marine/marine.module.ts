import { Module } from '@nestjs/common';
import { MarineController } from './marine.controller';
import { MarineService } from './marine.service';
@Module({ controllers: [MarineController], providers: [MarineService], exports: [MarineService] })
export class MarineModule {}
