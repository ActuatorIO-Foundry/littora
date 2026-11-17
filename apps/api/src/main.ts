import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpBoundary } from './http/http-boundary';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  configureHttpBoundary(app);
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  await app.listen(Number(process.env.API_PORT ?? 3000));
}
bootstrap();
