import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../../database/database.module';
import { InternalAccessGuard } from '../../shared/internal-access.guard';

@Controller('admin')
@UseGuards(InternalAccessGuard)
export class AdminController {
  constructor(@Inject(PG) private readonly db: Pool) {}
  @Get('health')
  async health() {
    const { rows } = await this.db.query('select exists(select 1 from moderation.queue) as pending');
    return { status: 'ok', moderationQueue: rows[0].pending };
  }
}
