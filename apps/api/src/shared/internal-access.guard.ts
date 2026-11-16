import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class InternalAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = process.env.ADMIN_API_TOKEN;
    if (!token || token.length < 32 || /\s/.test(token)) {
      throw new ServiceUnavailableException('Internal operations are disabled');
    }

    const request = context.switchToHttp().getRequest();
    const header: unknown = request.headers.authorization;
    const supplied = typeof header === 'string' && /^Bearer /i.test(header)
      ? header.slice(7)
      : '';
    const expectedBytes = Buffer.from(token);
    const suppliedBytes = Buffer.from(supplied);
    if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
