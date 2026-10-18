import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { loadBackendEnv } from './load-env.js';

loadBackendEnv();
const startup = new Logger('Bootstrap');
startup.log(process.env.GEOAPIFY_API_KEY?.trim() ? 'Geoapify API key is configured' : 'Geoapify API key is not configured');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
