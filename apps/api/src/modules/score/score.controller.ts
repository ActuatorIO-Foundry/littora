import { Controller, Get, Param } from '@nestjs/common';
import { ScoreService } from './score.service';
@Controller('score')
export class ScoreController {
  constructor(private readonly score: ScoreService) {}
  @Get('beach/:id')
  get(@Param('id') id: string) { return this.score.scoreBeach(id); }
}
