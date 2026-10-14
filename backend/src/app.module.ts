import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { DeliveryModule } from './delivery/delivery.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RiderModule } from './rider/rider.module.js';

@Module({
  imports: [PrismaModule, AuthModule, RiderModule, CustomerModule, DeliveryModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
