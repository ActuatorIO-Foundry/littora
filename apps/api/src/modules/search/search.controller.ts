import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { SearchInput } from './search-input';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}
  @Post('beaches')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  search(@Body() input: SearchInput) { return this.service.search(input); }
}
