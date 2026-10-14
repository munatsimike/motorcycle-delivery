import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DeliveryController } from './delivery.controller.js';
import { DeliveryPricingController } from './delivery-pricing.controller.js';
import { DeliveryPricingService } from './delivery-pricing.service.js';
import { DeliveryService } from './delivery.service.js';
import { DispatchService } from './dispatch.service.js';
import { RiderOfferController } from './rider-offer.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [DeliveryController, DeliveryPricingController, RiderOfferController],
  providers: [DeliveryService, DeliveryPricingService, DispatchService],
  exports: [DispatchService],
})
export class DeliveryModule {}
