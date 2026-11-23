import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MemberAccess } from './member-access.service';
import { MembersController } from './members.controller';

@Module({controllers: [MembersController], providers: [MemberAccess]})
export class MembersModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply((_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Cache-Control','private, no-store');
      res.vary('Cookie');
      next();
    }).forRoutes(MembersController);
  }
}
