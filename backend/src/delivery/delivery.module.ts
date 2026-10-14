import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DeliveryController } from './delivery.controller.js';
import { DeliveryPricingController } from './delivery-pricing.controller.js';
import { DeliveryPricingService } from './delivery-pricing.service.js';
import { DeliveryService } from './delivery.service.js';

@Module({
  imports: [AuthModule],
  controllers: [DeliveryController, DeliveryPricingController],
  providers: [DeliveryService, DeliveryPricingService],
})
export class DeliveryModule {}
