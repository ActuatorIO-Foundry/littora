import { Controller, Post, UseGuards } from '@nestjs/common';
import { InternalAccessGuard } from '../../shared/internal-access.guard';
import { IngestionService } from './ingestion.service';

@Controller('ingestion')
@UseGuards(InternalAccessGuard)
export class IngestionController {
  constructor(private s: IngestionService) {}

  @Post('water-quality')
  water() {
    return this.s.waterQuality();
  }
}
