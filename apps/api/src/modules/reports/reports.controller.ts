import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportInput } from './report-input';
import { contributionAddress } from './contribution-address';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Post('session')
  session(@Req() request: any, @Res({passthrough:true}) response: any) {
    response.setHeader('Cache-Control','no-store');
    return this.reports.session(contributionAddress(request));
  }
  @Post()
  create(@Body() body: ReportInput, @Req() request: any) {
    const header=request.headers.authorization;
    const token=typeof header==='string'&&header.startsWith('Bearer ')?header.slice(7):undefined;
    return this.reports.create(body,{token,address:contributionAddress(request)});
  }
  @Get()
  list(@Query('beachId') beachId: string) { return this.reports.list(beachId); }
}
