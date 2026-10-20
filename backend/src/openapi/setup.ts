import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

const DOCS_PATH = 'api/docs';
const DOCS_JSON_PATH = 'api/docs-json';

export function swaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SWAGGER_ENABLED === 'true') {
    return true;
  }
  if (env.SWAGGER_ENABLED === 'false') {
    return false;
  }
  return env.NODE_ENV !== 'production';
}

export function openApiConfig() {
  const port = process.env.PORT?.trim() || '3000';
  return new DocumentBuilder()
    .setTitle('Riders API')
    .setDescription('HTTP API for the Riders motorcycle delivery platform. Protected routes use the access token from OTP or admin verification as a bearer token.')
    .setVersion('1.0.0')
    .addServer(`http://localhost:${port}`)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token or, for registration place search, the registration proof token. Send it as Authorization: Bearer <token>.',
      },
      'bearer',
    )
    .build();
}

export function configureSwagger(app: INestApplication): void {
  if (!swaggerEnabled()) {
    return;
  }
  const document = SwaggerModule.createDocument(app, openApiConfig());
  SwaggerModule.setup(DOCS_PATH, app, document, {
    jsonDocumentUrl: DOCS_JSON_PATH,
    swaggerOptions: { persistAuthorization: true },
  });
}

/**
 * Helmet stays on every API route. Swagger UI needs its own scripts, so the
 * documentation paths skip Helmet only while documentation is enabled.
 */
export function configureHttpSecurity(app: INestApplication): void {
  const protect = helmet();
  const docsOpen = swaggerEnabled();
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (docsOpen && isDocumentationPath(request.path)) {
      next();
      return;
    }
    protect(request, response, next);
  });
}

function isDocumentationPath(path: string): boolean {
  return path === `/${DOCS_PATH}` || path.startsWith(`/${DOCS_PATH}/`) || path === `/${DOCS_JSON_PATH}`;
}
