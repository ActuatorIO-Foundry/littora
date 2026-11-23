import { BadRequestException, Controller, Delete, ForbiddenException, Get, Req, Res, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MemberAccess } from './member-access.service';
import { cookieScope, memberCookie, readMemberSession, revokeMemberSession } from './member-session';

@Controller('member/session')
export class MembersController {
  constructor(private readonly access: MemberAccess) {}

  @Get()
  async current(@Req() request: Request) {
    const pool = await this.access.reader();
    const member = await readMemberSession(pool, request.headers.cookie).catch(() => { throw new ServiceUnavailableException(); });
    if (!member) throw new UnauthorizedException();
    return member;
  }

  @Delete()
  async logout(@Req() request: Request, @Res({passthrough: true}) response: Response) {
    if (!this.access.origin) throw new ServiceUnavailableException();
    if (request.headers.origin !== this.access.origin ||
        (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) throw new ForbiddenException();
    const pool = await this.access.reader();
    const signedOut = await revokeMemberSession(pool, request.headers.cookie).catch(() => { throw new ServiceUnavailableException(); });
    if (!signedOut) throw new BadRequestException();
    response.clearCookie(memberCookie, cookieScope);
    return {signedOut: true};
  }
}
