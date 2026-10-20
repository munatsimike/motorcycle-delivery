import { Test } from '@nestjs/testing';
import { SwaggerModule } from '@nestjs/swagger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AppController } from '../app.controller.js';
import { AppService } from '../app.service.js';
import { AdminDashboardController } from '../admin-dashboard/admin-dashboard.controller.js';
import { AdminDashboardService } from '../admin-dashboard/admin-dashboard.service.js';
import { AdminAccessService } from '../auth/admin-access.service.js';
import { AdminAuthController } from '../auth/admin-auth.controller.js';
import { AdminLoginService } from '../auth/admin-login.service.js';
import { AccessTokenService } from '../auth/access-token.service.js';
import { CustomerAccessService } from '../auth/customer-access.service.js';
import { CustomerAuthController } from '../auth/customer-auth.controller.js';
import { OtpAuthService } from '../auth/otp-auth.service.js';
import { RiderAccessService } from '../auth/rider-access.service.js';
import { RiderAuthController } from '../auth/rider-auth.controller.js';
import { SessionController } from '../auth/session.controller.js';
import { SessionService } from '../auth/session.service.js';
import { CustomerAccountController } from '../customer/customer-account.controller.js';
import { CustomerAccountService } from '../customer/customer-account.service.js';
import { AdminDeliveryController } from '../delivery/admin-delivery.controller.js';
import { AdminDeliveryListService } from '../delivery/admin-delivery-list.service.js';
import { DeliveryController } from '../delivery/delivery.controller.js';
import { DeliveryPricingController } from '../delivery/delivery-pricing.controller.js';
import { DeliveryPricingService } from '../delivery/delivery-pricing.service.js';
import { DeliveryService } from '../delivery/delivery.service.js';
import { DispatchService } from '../delivery/dispatch.service.js';
import { NearbyRidersController } from '../delivery/nearby-riders.controller.js';
import { NearbyRidersService } from '../delivery/nearby-riders.service.js';
import { PlacesController } from '../delivery/places.controller.js';
import { PlacesService } from '../delivery/places.service.js';
import { RegistrationPlacesController } from '../delivery/registration-places.controller.js';
import { RiderAssignmentController } from '../delivery/rider-assignment.controller.js';
import { RiderAvailabilityAlertController } from '../delivery/rider-availability-alert.controller.js';
import { RiderAvailabilityAlertService } from '../delivery/rider-availability-alert.service.js';
import { RiderDeliveryController } from '../delivery/rider-delivery.controller.js';
import { RiderOfferController } from '../delivery/rider-offer.controller.js';
import { CommissionPolicyController } from '../rider/commission-policy.controller.js';
import { CommissionPolicyService } from '../rider/commission-policy.service.js';
import { LicenceImageController } from '../rider/licence-image.controller.js';
import { LicenceImageService } from '../rider/licence-image.service.js';
import { LicenceReviewService } from '../rider/licence-review.service.js';
import { MotorcycleController } from '../rider/motorcycle.controller.js';
import { MotorcycleListService } from '../rider/motorcycle-list.service.js';
import { MotorcycleReviewController } from '../rider/motorcycle-review.controller.js';
import { MotorcycleReviewService } from '../rider/motorcycle-review.service.js';
import { MotorcycleService } from '../rider/motorcycle.service.js';
import { RiderAdminController } from '../rider/rider-admin.controller.js';
import { RiderApprovalService } from '../rider/rider-approval.service.js';
import { RiderAvailabilityController } from '../rider/rider-availability.controller.js';
import { RiderAvailabilityService } from '../rider/rider-availability.service.js';
import { RiderListService } from '../rider/rider-list.service.js';
import { RiderLocationController } from '../rider/rider-location.controller.js';
import { RiderLocationService } from '../rider/rider-location.service.js';
import { RiderOnboardingController } from '../rider/rider-onboarding.controller.js';
import { RiderOnboardingService } from '../rider/rider-onboarding.service.js';
import { RiderWalletController } from '../rider/rider-wallet.controller.js';
import { WalletConfigController } from '../rider/wallet-config.controller.js';
import { WalletConfigService } from '../rider/wallet-config.service.js';
import { WalletService } from '../rider/wallet.service.js';
import { openApiConfig, swaggerEnabled } from './setup.js';

const unused = {};

describe('OpenAPI document', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        AppController,
        CustomerAuthController,
        RiderAuthController,
        AdminAuthController,
        SessionController,
        CustomerAccountController,
        DeliveryController,
        PlacesController,
        RegistrationPlacesController,
        NearbyRidersController,
        RiderAvailabilityAlertController,
        AdminDeliveryController,
        DeliveryPricingController,
        RiderOfferController,
        RiderDeliveryController,
        RiderAssignmentController,
        RiderOnboardingController,
        RiderAvailabilityController,
        RiderLocationController,
        MotorcycleController,
        LicenceImageController,
        RiderWalletController,
        RiderAdminController,
        MotorcycleReviewController,
        CommissionPolicyController,
        WalletConfigController,
        AdminDashboardController,
      ],
      providers: [
        { provide: AppService, useValue: unused },
        { provide: OtpAuthService, useValue: unused },
        { provide: AdminLoginService, useValue: unused },
        { provide: AccessTokenService, useValue: unused },
        { provide: SessionService, useValue: unused },
        { provide: CustomerAccessService, useValue: unused },
        { provide: RiderAccessService, useValue: unused },
        { provide: AdminAccessService, useValue: unused },
        { provide: CustomerAccountService, useValue: unused },
        { provide: DeliveryService, useValue: unused },
        { provide: DispatchService, useValue: unused },
        { provide: PlacesService, useValue: unused },
        { provide: NearbyRidersService, useValue: unused },
        { provide: RiderAvailabilityAlertService, useValue: unused },
        { provide: AdminDeliveryListService, useValue: unused },
        { provide: DeliveryPricingService, useValue: unused },
        { provide: RiderOnboardingService, useValue: unused },
        { provide: RiderAvailabilityService, useValue: unused },
        { provide: RiderLocationService, useValue: unused },
        { provide: MotorcycleService, useValue: unused },
        { provide: LicenceImageService, useValue: unused },
        { provide: WalletService, useValue: unused },
        { provide: LicenceReviewService, useValue: unused },
        { provide: RiderApprovalService, useValue: unused },
        { provide: RiderListService, useValue: unused },
        { provide: MotorcycleReviewService, useValue: unused },
        { provide: MotorcycleListService, useValue: unused },
        { provide: CommissionPolicyService, useValue: unused },
        { provide: WalletConfigService, useValue: unused },
        { provide: AdminDashboardService, useValue: unused },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 20_000);

  afterAll(async () => {
    await app?.close();
  });

  it('describes rider verification and admin delivery pricing without sample credentials', () => {
    const document = SwaggerModule.createDocument(app, openApiConfig());
    expect(document.openapi).toMatch(/^3\./);
    expect(document.components?.securitySchemes?.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });

    const verify = document.paths?.['/auth/rider/login/verify']?.post;
    expect(verify?.requestBody).toBeTruthy();
    const verifySchema = schemaOf(document, verify?.requestBody);
    expect(verifySchema.required).toEqual(expect.arrayContaining(['phone', 'code']));
    expect(verifySchema.properties?.code).not.toHaveProperty('example');
    expect(verify?.responses?.['200']).toBeTruthy();
    expect(verify?.responses?.['401']).toBeTruthy();

    const pricingGet = document.paths?.['/admin/delivery-pricing']?.get;
    const pricingPut = document.paths?.['/admin/delivery-pricing']?.put;
    expect(pricingGet?.security).toEqual([{ bearer: [] }]);
    expect(pricingPut?.security).toEqual([{ bearer: [] }]);
    const pricingSchema = schemaOf(document, pricingPut?.requestBody);
    expect(pricingSchema.required).toEqual(expect.arrayContaining([
      'baseFee',
      'pricePerKilometre',
      'minimumTripMetres',
      'maximumTripMetres',
    ]));
    expect(pricingSchema.properties?.currency?.enum).toEqual(['USD']);
    expect(document.paths?.['/admin/delivery-pricing']?.get?.responses?.['404']).toBeTruthy();

    const operations = Object.values(document.paths ?? {}).flatMap((path) =>
      Object.keys(path ?? {}).filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method)),
    );
    expect(operations.length).toBeGreaterThan(60);
    expect(JSON.stringify(document)).not.toMatch(/refresh-token-value|password-value|123456/);
  });
});

describe('swagger availability', () => {
  it('stays off in production unless explicitly enabled', () => {
    expect(swaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(swaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' })).toBe(true);
    expect(swaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(swaggerEnabled({ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' })).toBe(false);
  });
});

function schemaOf(document: ReturnType<typeof SwaggerModule.createDocument>, body: unknown) {
  const requestBody = body as { content?: { 'application/json'?: { schema?: { $ref?: string } } } };
  const ref = requestBody.content?.['application/json']?.schema?.$ref;
  expect(ref).toBeTruthy();
  const name = ref!.replace('#/components/schemas/', '');
  return document.components?.schemas?.[name] as {
    required?: string[];
    properties?: Record<string, { example?: unknown; enum?: string[] }>;
  };
}
