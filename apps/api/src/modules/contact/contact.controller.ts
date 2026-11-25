import { Body, Controller, Get, Header, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { contributionAddress } from '../reports/contribution-address';
import { ContactStore } from './contact-store.service';

@Controller('contact')
export class ContactController {
  constructor(private readonly store: ContactStore) {}
  @Get('availability') @Header('Cache-Control','no-store')
  async availability() { return {available:await this.store.available()}; }
  @Post() @Header('Cache-Control','no-store')
  submit(@Body() data: {email:string;topic:string;message:string}, @Req() request: IncomingMessage) {
    return this.store.submit(data,contributionAddress(request));
  }
}
