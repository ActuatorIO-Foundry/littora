import { ArgumentsHost, BadRequestException, CallHandler, Catch, ExceptionFilter, ExecutionContext, HttpException, INestApplication, InternalServerErrorException, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { map } from 'rxjs';
import { contract, inputValidator, operations, responseValidator, validationDetails } from './contract';
import { present } from './presenters';

class ContractInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const route = request.route.path.replace(/^\/api/, '').replace(/:([A-Za-z]+)/g, '{$1}');
    const operation = operations.get(`${request.method} ${route}`);
    if (!operation) throw new InternalServerErrorException();
    for (const location of ['query', 'path', 'body'] as const) {
      const value = location === 'path' ? request.params : request[location];
      const candidate = value == null && !operation.requestBody ? {} : value;
      // Validate a copy: Express query getters and the legacy controllers keep their string inputs.
      const validate = inputValidator(operation, location);
      if (!validate(candidate === undefined ? null : structuredClone(candidate))) {
        throw new BadRequestException({ details: validationDetails(validate.errors) });
      }
    }
    const query = request.query;
    if (('lat' in query) !== ('lon' in query)) throw new BadRequestException();
    if ('bbox' in query) {
      const [south, west, north, east] = query.bbox.split(',').map(Number);
      if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) throw new BadRequestException();
    }
    return next.handle().pipe(map(data => {
      // Match the JSON wire representation (pg timestamps/numerics, NaN and undefined included).
      const payload = JSON.parse(JSON.stringify(present(operation.operationId, data, query)));
      const validate = responseValidator(operation, context.switchToHttp().getResponse().statusCode);
      if (!validate(payload)) {
        console.error(JSON.stringify({event:'response_contract_violation', operation:operation.operationId, requestId:request.requestId}));
        throw new InternalServerErrorException();
      }
      return payload;
    }));
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const request = host.switchToHttp().getRequest();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body = error instanceof HttpException ? error.getResponse() : null;
    const details = body && typeof body === 'object' && 'details' in body && Array.isArray(body.details) ? body.details : [];
    const codes: Record<number, string> = { 400: details.length ? 'VALIDATION_ERROR' : 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
      404: 'NOT_FOUND', 409: 'CONFLICT', 429: 'RATE_LIMITED', 503: 'UNAVAILABLE' };
    const messages: Record<number, string> = { 400: 'Invalid request', 401: 'Authentication required', 403: 'Access denied',
      404: 'Resource not found', 409: 'Resource conflict', 429: 'Too many requests', 503: 'Service unavailable' };
    const requestId = request.requestId ?? randomUUID();
    if (status >= 500) console.error(JSON.stringify({event:'api_request_failed', status, requestId}));
    response.status(status).json({ statusCode: status, code: codes[status] ?? 'INTERNAL_ERROR',
      message: messages[status] ?? 'Internal server error', requestId, details });
  }
}

export function configureHttpBoundary(app: INestApplication) {
  app.use((request: any, response: any, next: () => void) => {
    request.requestId = randomUUID();
    response.setHeader('x-request-id', request.requestId);
    response.setHeader('x-api-version', contract.info.version);
    if (/^\/api\/contact(?:[/?]|$)/.test(request.url)) response.setHeader('cache-control','no-store');
    next();
  });
  // Read-only contract endpoint bypasses business services and never opens a database connection.
  app.getHttpAdapter().get('/api/openapi.json', (_request: unknown, response: any) => response.json(contract));
  app.useGlobalInterceptors(new ContractInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());
}
