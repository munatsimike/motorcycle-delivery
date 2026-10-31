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
import { RiderAccessService } from '../auth/rider-access.service.js';
import { WhatsAppAuthService } from '../auth/whatsapp-auth.service.js';
import { RiderAuthController } from '../auth/rider-auth.controller.js';
import { SessionController } from '../auth/session.controller.js';
import { SessionService } from '../auth/session.service.js';
import { AdminCustomerController } from '../customer/admin-customer.controller.js';
import { AdminCustomerListService } from '../customer/admin-customer-list.service.js';
import { CustomerAccountController } from '../customer/customer-account.controller.js';
import { CustomerAccountService } from '../customer/customer-account.service.js';
import { CustomerFcmDeviceController } from '../customer/customer-fcm-device.controller.js';
import { CustomerFcmDeviceService } from '../customer/customer-fcm-device.service.js';
import { AdminDeliveryController } from '../delivery/admin-delivery.controller.js';
import { AdminDeliveryListService } from '../delivery/admin-delivery-list.service.js';
import { CustomerBidController } from '../delivery/customer-bid.controller.js';
import { DeliveryController } from '../delivery/delivery.controller.js';
import { BidAcceptanceService } from '../delivery/bid-acceptance.service.js';
import { BidService } from '../delivery/bid.service.js';
import { RiderBidController } from '../delivery/rider-bid.controller.js';
import { ClassPricingService } from '../delivery/class-pricing.service.js';
import { DeliveryPricingController } from '../delivery/delivery-pricing.controller.js';
import { DeliveryService } from '../delivery/delivery.service.js';
import { DispatchService } from '../delivery/dispatch.service.js';
import { NearbyRidersController } from '../delivery/nearby-riders.controller.js';
import { NearbyRidersService } from '../delivery/nearby-riders.service.js';
import { PlacesController } from '../delivery/places.controller.js';
import { PlacesService } from '../delivery/places.service.js';
import { RegistrationAddressController } from '../delivery/registration-address.controller.js';
import { RegistrationPlaceLimiter } from '../delivery/registration-address-limit.js';
import { RegistrationPlacesController } from '../delivery/registration-places.controller.js';
import { RiderAssignmentController } from '../delivery/rider-assignment.controller.js';
import { RiderAvailabilityAlertController } from '../delivery/rider-availability-alert.controller.js';
import { RiderAvailabilityAlertService } from '../delivery/rider-availability-alert.service.js';
import { RiderDeliveryController } from '../delivery/rider-delivery.controller.js';
import { RiderPushDeviceController } from '../rider/rider-push-device.controller.js';
import { RiderPushDeviceService } from '../rider/rider-push-device.service.js';
import { V2CommissionRateController } from '../rider/v2-commission-rate.controller.js';
import { V2CommissionRateService } from '../rider/v2-commission-rate.service.js';
import { LicenceImageController } from '../rider/licence-image.controller.js';
import { LicenceImageService } from '../rider/licence-image.service.js';
import { CustomerAccountProfilePhotoController } from '../rider/customer-account-profile-photo.controller.js';
import { CustomerAccountProfilePhotoService } from '../rider/customer-account-profile-photo.service.js';
import { CustomerProfilePhotoController } from '../rider/customer-profile-photo.controller.js';
import { CustomerProfilePhotoService } from '../rider/customer-profile-photo.service.js';
import { ProfilePhotoController } from '../rider/profile-photo.controller.js';
import { ProfilePhotoService } from '../rider/profile-photo.service.js';
import { LicenceReviewService } from '../rider/licence-review.service.js';
import { MotorcycleController } from '../rider/motorcycle.controller.js';
import { MotorcycleListService } from '../rider/motorcycle-list.service.js';
import { MotorcycleReviewController } from '../rider/motorcycle-review.controller.js';
import { MotorcycleReviewService } from '../rider/motorcycle-review.service.js';
import { MotorcycleService } from '../rider/motorcycle.service.js';
import { RiderAdminController } from '../rider/rider-admin.controller.js';
import { RiderApprovalService } from '../rider/rider-approval.service.js';
import { RiderAvailabilityController } from '../rider/rider-availability.controller.js';
import { RiderReceivingController } from '../rider/rider-receiving.controller.js';
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
        AdminCustomerController,
        CustomerFcmDeviceController,
        CustomerBidController,
        DeliveryController,
        RiderBidController,
        PlacesController,
        RegistrationAddressController,
        RegistrationPlacesController,
        NearbyRidersController,
        RiderAvailabilityAlertController,
        AdminDeliveryController,
        DeliveryPricingController,
        RiderPushDeviceController,
        RiderDeliveryController,
        RiderAssignmentController,
        RiderOnboardingController,
        RiderAvailabilityController,
        RiderReceivingController,
        RiderLocationController,
        MotorcycleController,
        LicenceImageController,
        ProfilePhotoController,
        CustomerProfilePhotoController,
        CustomerAccountProfilePhotoController,
        RiderWalletController,
        RiderAdminController,
        MotorcycleReviewController,
        V2CommissionRateController,
        WalletConfigController,
        AdminDashboardController,
      ],
      providers: [
        { provide: AppService, useValue: unused },
        { provide: WhatsAppAuthService, useValue: unused },
        { provide: AdminLoginService, useValue: unused },
        { provide: AccessTokenService, useValue: unused },
        { provide: SessionService, useValue: unused },
        { provide: CustomerAccessService, useValue: unused },
        { provide: RiderAccessService, useValue: unused },
        { provide: AdminAccessService, useValue: unused },
        { provide: CustomerAccountService, useValue: unused },
        { provide: AdminCustomerListService, useValue: unused },
        { provide: CustomerFcmDeviceService, useValue: unused },
        { provide: BidAcceptanceService, useValue: unused },
        { provide: BidService, useValue: unused },
        { provide: DeliveryService, useValue: unused },
        { provide: DispatchService, useValue: unused },
        { provide: PlacesService, useValue: unused },
        RegistrationPlaceLimiter,
        { provide: NearbyRidersService, useValue: unused },
        { provide: RiderAvailabilityAlertService, useValue: unused },
        { provide: AdminDeliveryListService, useValue: unused },
        { provide: ClassPricingService, useValue: unused },
        { provide: RiderOnboardingService, useValue: unused },
        { provide: RiderAvailabilityService, useValue: unused },
        { provide: RiderPushDeviceService, useValue: unused },
        { provide: RiderLocationService, useValue: unused },
        { provide: MotorcycleService, useValue: unused },
        { provide: LicenceImageService, useValue: unused },
        { provide: ProfilePhotoService, useValue: unused },
        { provide: CustomerProfilePhotoService, useValue: unused },
        { provide: CustomerAccountProfilePhotoService, useValue: unused },
        { provide: WalletService, useValue: unused },
        { provide: LicenceReviewService, useValue: unused },
        { provide: RiderApprovalService, useValue: unused },
        { provide: RiderListService, useValue: unused },
        { provide: MotorcycleReviewService, useValue: unused },
        { provide: MotorcycleListService, useValue: unused },
        { provide: V2CommissionRateService, useValue: unused },
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

    const verify = document.paths?.['/auth/rider/register/whatsapp/verify']?.post;
    expect(document.paths?.['/auth/rider/login/otp']).toBeUndefined();
    expect(document.paths?.['/auth/rider/register/otp']).toBeUndefined();
    expect(document.paths?.['/auth/customer/login']).toBeUndefined();
    expect(document.paths?.['/auth/customer/register']).toBeUndefined();
    expect(verify?.requestBody).toBeTruthy();
    const verifySchema = schemaOf(document, verify?.requestBody);
    expect(verifySchema.required).toEqual(expect.arrayContaining(['phone', 'code']));
    expect(verifySchema.properties?.code).not.toHaveProperty('example');
    expect(verify?.responses?.['200']).toBeTruthy();
    expect(verify?.responses?.['401']).toBeTruthy();

    expect(document.paths?.['/admin/delivery-pricing']?.get).toBeUndefined();
    expect(document.paths?.['/admin/delivery-pricing']?.put).toBeUndefined();
    expect(document.paths?.['/admin/commission-policy']).toBeUndefined();

    const classes = document.paths?.['/admin/delivery-pricing/classes']?.get;
    const publish = document.paths?.['/admin/delivery-pricing/classes/{serviceClass}']?.post;
    const windowToggle = document.paths?.['/admin/delivery-pricing/classes/{serviceClass}/windows/{windowId}']?.post;
    const audits = document.paths?.['/admin/delivery-pricing/audits']?.get;
    expect(classes?.security).toEqual([{ bearer: [] }]);
    expect(publish?.security).toEqual([{ bearer: [] }]);
    expect(windowToggle?.security).toEqual([{ bearer: [] }]);
    expect(audits?.security).toEqual([{ bearer: [] }]);
    const publishSchema = schemaOf(document, publish?.requestBody);
    expect(publishSchema.required).toEqual(expect.arrayContaining([
      'pricingModel',
      'minimumTripMetres',
      'maximumTripMetres',
    ]));
    expect(publishSchema.required ?? []).not.toContain('baseFee');
    expect(publishSchema.properties?.pricingModel?.enum).toEqual([
      'FIXED',
      'PER_KILOMETRE',
      'BASE_PLUS_PER_KILOMETRE',
      'DISTANCE_TIERS',
      'INCLUDED_DISTANCE',
    ]);
    const classList = schemaOf(document, classes?.responses?.['200']);
    expect(classList.required).toEqual(expect.arrayContaining(['express', 'flexible']));
    const auditPage = schemaOf(document, audits?.responses?.['200']);
    const paginationRef = auditPage.properties?.pagination as { $ref?: string } | undefined;
    const paginationName = paginationRef?.$ref?.replace('#/components/schemas/', '');
    const pagination = document.components?.schemas?.[paginationName ?? ''] as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(pagination.required).toEqual(expect.arrayContaining(['page', 'limit', 'total', 'totalPages']));

    const v2Rate = document.paths?.['/admin/v2-commission-rate']?.get;
    const v2Publish = document.paths?.['/admin/v2-commission-rate']?.post;
    const v2Audits = document.paths?.['/admin/v2-commission-rate/audits']?.get;
    expect(v2Rate?.security).toEqual([{ bearer: [] }]);
    expect(v2Publish?.security).toEqual([{ bearer: [] }]);
    expect(v2Audits?.security).toEqual([{ bearer: [] }]);
    const v2Body = schemaOf(document, v2Publish?.requestBody);
    expect(v2Body.required).toEqual(['percentage']);

    const operations = Object.values(document.paths ?? {}).flatMap((path) =>
      Object.keys(path ?? {}).filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method)),
    );
    const push = document.paths?.['/riders/me/push-devices'];
    expect(push?.put?.security).toEqual([{ bearer: [] }]);
    expect(push?.put?.responses?.['200']).toBeTruthy();
    expect(push?.delete?.responses?.['204']).toBeTruthy();
    const pushSchema = schemaOf(document, push?.put?.requestBody);
    expect(pushSchema.properties?.fcmToken).toBeTruthy();
    expect(JSON.stringify(pushSchema)).not.toMatch(/fcm-token|device-token/);
    const customerPush = document.paths?.['/customers/me/push-devices'];
    expect(customerPush?.put?.security).toEqual([{ bearer: [] }]);
    expect(customerPush?.put?.responses?.['200']).toBeTruthy();
    expect(customerPush?.delete?.responses?.['204']).toBeTruthy();
    expect(JSON.stringify(customerPush)).not.toMatch(/rider_offer/);

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
