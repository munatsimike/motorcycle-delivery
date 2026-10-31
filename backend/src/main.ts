import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { firebaseAccountReady } from './delivery/fcm-v2-sender.js';
import { assertSelectedWhatsAppProvider } from './auth/whatsapp-verification.js';
import { loadBackendEnv } from './load-env.js';
import { adminCorsOptions } from './http/admin-cors.js';
import { configureHttpSecurity, configureSwagger } from './openapi/setup.js';

loadBackendEnv();
const startup = new Logger('Bootstrap');
try {
  assertSelectedWhatsAppProvider(process.env);
} catch (error) {
  startup.error(error instanceof Error ? error.message : 'WhatsApp verification is not configured');
  process.exit(1);
}
startup.log(process.env.GEOAPIFY_API_KEY?.trim() ? 'Geoapify API key is configured' : 'Geoapify API key is not configured');
startup.log(process.env.GOOGLE_MAPS_API_KEY?.trim() ? 'Google Maps API key is configured' : 'Google Maps API key is not configured');
startup.log(firebaseAccountReady(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  ? 'Firebase service account is configured'
  : 'Firebase service account is not configured');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const cors = adminCorsOptions(process.env);
  if (cors) {
    app.enableCors(cors);
  }

  configureHttpSecurity(app);
  configureSwagger(app);

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
