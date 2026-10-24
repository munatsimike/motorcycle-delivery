import { Module } from '@nestjs/common';
import { AdminDeliveryController } from './admin-delivery.controller.js';
import { AdminDeliveryListService } from './admin-delivery-list.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { DeliveryController } from './delivery.controller.js';
import { DeliveryPricingController } from './delivery-pricing.controller.js';
import { ClassPricingService } from './class-pricing.service.js';
import { DeliveryPricingService } from './delivery-pricing.service.js';
import { DeliveryService } from './delivery.service.js';
import { CoordinateRetentionService } from './coordinate-retention.service.js';
import { DispatchService } from './dispatch.service.js';
import { FcmOfferSender, OfferPushSender } from './fcm-offer-sender.js';
import { RiderOfferNotificationService } from './rider-offer-notification.service.js';
import { ROAD_DISTANCE, geoapifyRoadDistance } from './geoapify.js';
import { NearbyRidersController } from './nearby-riders.controller.js';
import { NearbyRidersService } from './nearby-riders.service.js';
import { PlacesController } from './places.controller.js';
import { RegistrationPlacesController } from './registration-places.controller.js';
import { PlacesService } from './places.service.js';
import { RiderAvailabilityAlertController } from './rider-availability-alert.controller.js';
import { RiderAvailabilityAlertService } from './rider-availability-alert.service.js';
import { RiderAssignmentController } from './rider-assignment.controller.js';
import { RiderDeliveryController } from './rider-delivery.controller.js';
import { RiderOfferController } from './rider-offer.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminDeliveryController, DeliveryController, DeliveryPricingController, NearbyRidersController, PlacesController, RegistrationPlacesController, RiderAssignmentController, RiderAvailabilityAlertController, RiderDeliveryController, RiderOfferController],
  providers: [
    AdminDeliveryListService,
    DeliveryService,
    ClassPricingService,
    DeliveryPricingService,
    DispatchService,
    RiderOfferNotificationService,
    FcmOfferSender,
    { provide: OfferPushSender, useExisting: FcmOfferSender },
    NearbyRidersService,
    PlacesService,
    RiderAvailabilityAlertService,
    CoordinateRetentionService,
    { provide: ROAD_DISTANCE, useFactory: () => geoapifyRoadDistance() },
  ],
  exports: [DispatchService, RiderOfferNotificationService, RiderAvailabilityAlertService, CoordinateRetentionService],
})
export class DeliveryModule {}
