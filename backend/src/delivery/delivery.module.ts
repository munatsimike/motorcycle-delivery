import { Module } from '@nestjs/common';
import { AdminDeliveryController } from './admin-delivery.controller.js';
import { AdminDeliveryListService } from './admin-delivery-list.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { DeliveryController } from './delivery.controller.js';
import { DeliveryPricingController } from './delivery-pricing.controller.js';
import { DeliveryPricingService } from './delivery-pricing.service.js';
import { DeliveryService } from './delivery.service.js';
import { DispatchService } from './dispatch.service.js';
import { RiderDeliveryController } from './rider-delivery.controller.js';
import { RiderOfferController } from './rider-offer.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminDeliveryController, DeliveryController, DeliveryPricingController, RiderDeliveryController, RiderOfferController],
  providers: [AdminDeliveryListService, DeliveryService, DeliveryPricingService, DispatchService],
  exports: [DispatchService],
})
export class DeliveryModule {}
