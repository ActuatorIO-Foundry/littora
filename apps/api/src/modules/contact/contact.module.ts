import { Module } from '@nestjs/common';
import { ContactStore } from './contact-store.service';
import { ContactController } from './contact.controller';

@Module({providers:[ContactStore],controllers:[ContactController]})
export class ContactModule {}
