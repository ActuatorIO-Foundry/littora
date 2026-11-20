import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpBoundary } from './http/http-boundary';
import { installFatalDiagnostics } from './shared/runtime-diagnostics';
const { MigrationError } = require('../scripts/database.cjs');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {logger:false, abortOnError:false});
  app.setGlobalPrefix('api');
  configureHttpBoundary(app);
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  await app.listen(Number(process.env.API_PORT ?? 3000));
  console.info('{"event":"api_ready"}');
}
installFatalDiagnostics('api');
bootstrap().catch(error => {
  const event = error instanceof MigrationError && error.message.startsWith('Database migrations required.')
    ? 'database_migrations_required' : 'api_startup_failed';
  console.error(JSON.stringify({event}));
  process.exit(1);
});
