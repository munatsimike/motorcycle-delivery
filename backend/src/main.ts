import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadBackendEnv } from './load-env.js';
import { configureHttpSecurity, configureSwagger } from './openapi/setup.js';

loadBackendEnv();
const startup = new Logger('Bootstrap');
startup.log(process.env.GEOAPIFY_API_KEY?.trim() ? 'Geoapify API key is configured' : 'Geoapify API key is not configured');
startup.log(process.env.GOOGLE_MAPS_API_KEY?.trim() ? 'Google Maps API key is configured' : 'Google Maps API key is not configured');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  configureHttpSecurity(app);
  configureSwagger(app);

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
