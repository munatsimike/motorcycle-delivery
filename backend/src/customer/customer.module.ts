import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminCustomerController } from './admin-customer.controller.js';
import { AdminCustomerListService } from './admin-customer-list.service.js';
import { CustomerAccountController } from './customer-account.controller.js';
import { CustomerAccountService } from './customer-account.service.js';
import { CustomerFcmDeviceController } from './customer-fcm-device.controller.js';
import { CustomerFcmDeviceService } from './customer-fcm-device.service.js';
import { CustomerSavedAddressController } from './customer-saved-address.controller.js';
import { CustomerSavedAddressService } from './customer-saved-address.service.js';

@Module({
  imports: [AuthModule],
  controllers: [CustomerAccountController, CustomerSavedAddressController, CustomerFcmDeviceController, AdminCustomerController],
  providers: [CustomerAccountService, CustomerSavedAddressService, CustomerFcmDeviceService, AdminCustomerListService],
})
export class CustomerModule {}
