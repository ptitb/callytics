import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { join } from 'path';
import { AppModule } from './app.module';
import { AppLogger } from './logger/app-logger';

async function bootstrap(): Promise<void> {
  const expressApp = express();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(expressApp),
    {
      bodyParser: true,
      logger: new AppLogger('NestApplication'),
    },
  );
  app.enableCors({ origin: '*' });
  app.useWebSocketAdapter(new IoAdapter(app.getHttpServer()));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useStaticAssets(join(process.cwd(), '..', 'storage'), { prefix: '/media/' });
  const port = Number(process.env.BACKEND_PORT || 3001);

  // Loopback by default: the web UI has no authentication, so the API must not be reachable from outside.
  const host = process.env.BACKEND_BIND_ADDR?.trim() || '127.0.0.1';

  await app.listen(port, host);
  AppLogger.event('BackendStarted', { port, host });
}

void bootstrap();
