import { Controller, Get, UseGuards } from '@nestjs/common';
import { InternalAccessGuard } from '../../shared/internal-access.guard';

@Controller('admin')
@UseGuards(InternalAccessGuard)
export class AdminController {
  @Get('health')
  health() {
    return { status: 'ok', moderationQueue: true };
  }
}
