import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

interface ReportBody {
  beachId: string;
  type: 'jellyfish' | 'pollution' | 'current' | 'crowd' | 'flag' | 'other';
  value?: Record<string, string>;
  confidence?: number;
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Post()
  create(@Body() body: ReportBody) { return this.reports.create(body); }
  @Get()
  list(@Query('beachId') beachId: string) { return this.reports.list(beachId); }
}
