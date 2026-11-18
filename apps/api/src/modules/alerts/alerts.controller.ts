import { Controller, Get, Header, Query } from '@nestjs/common';
import { AlertsService } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly service:AlertsService) {}
  @Get()
  @Header('Cache-Control','no-store')
  get(@Query('department') department?:string, @Query('beachId') beachId?:string) {
    return this.service.get(department,beachId);
  }
}
