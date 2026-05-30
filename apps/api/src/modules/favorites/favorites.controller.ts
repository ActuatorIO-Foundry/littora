import { Controller, Get } from '@nestjs/common';@Controller('favorites') export class FavoritesController{@Get() list(){return []}}
