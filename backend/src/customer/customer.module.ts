import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CustomerAccountController } from './customer-account.controller.js';
import { CustomerAccountService } from './customer-account.service.js';
import { CustomerFcmDeviceController } from './customer-fcm-device.controller.js';
import { CustomerFcmDeviceService } from './customer-fcm-device.service.js';

@Module({
  imports: [AuthModule],
  controllers: [CustomerAccountController, CustomerFcmDeviceController],
  providers: [CustomerAccountService, CustomerFcmDeviceService],
})
export class CustomerModule {}
