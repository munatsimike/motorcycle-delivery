import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CustomerAccountController } from './customer-account.controller.js';
import { CustomerAccountService } from './customer-account.service.js';

@Module({
  imports: [AuthModule],
  controllers: [CustomerAccountController],
  providers: [CustomerAccountService],
})
export class CustomerModule {}
