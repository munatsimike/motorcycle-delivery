import { Module } from '@nestjs/common';
import { AdminDeliveryController } from './admin-delivery.controller.js';
import { AdminDeliveryListService } from './admin-delivery-list.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { DeliveryController } from './delivery.controller.js';
import { DeliveryPricingController } from './delivery-pricing.controller.js';
import { DeliveryPricingService } from './delivery-pricing.service.js';
import { DeliveryService } from './delivery.service.js';
import { DispatchService } from './dispatch.service.js';
import { ROAD_DISTANCE, geoapifyRoadDistance } from './geoapify.js';
import { NearbyRidersController } from './nearby-riders.controller.js';
import { NearbyRidersService } from './nearby-riders.service.js';
import { PlacesController } from './places.controller.js';
import { RegistrationPlacesController } from './registration-places.controller.js';
import { PlacesService } from './places.service.js';
import { RiderAvailabilityAlertController } from './rider-availability-alert.controller.js';
import { RiderAvailabilityAlertService } from './rider-availability-alert.service.js';
import { RiderDeliveryController } from './rider-delivery.controller.js';
import { RiderOfferController } from './rider-offer.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminDeliveryController, DeliveryController, DeliveryPricingController, NearbyRidersController, PlacesController, RegistrationPlacesController, RiderAvailabilityAlertController, RiderDeliveryController, RiderOfferController],
  providers: [
    AdminDeliveryListService,
    DeliveryService,
    DeliveryPricingService,
    DispatchService,
    NearbyRidersService,
    PlacesService,
    RiderAvailabilityAlertService,
    { provide: ROAD_DISTANCE, useFactory: () => geoapifyRoadDistance() },
  ],
  exports: [DispatchService, RiderAvailabilityAlertService],
})
export class DeliveryModule {}
