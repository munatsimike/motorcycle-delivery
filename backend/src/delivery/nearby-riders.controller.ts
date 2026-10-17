import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { CustomerAccessGuard, type CustomerRequest } from '../auth/customer-access.guard.js';
import { NearbyRidersService } from './nearby-riders.service.js';

@Controller('customers/me/riders')
@UseGuards(CustomerAccessGuard)
export class NearbyRidersController {
  constructor(private readonly nearby: NearbyRidersService) {}

  @Get('nearby')
  count(
    @Req() request: CustomerRequest,
    @Query('latitude') latitude?: string,
    @Query('longitude') longitude?: string,
  ) {
    if (!request.customer) {
      throw new ForbiddenException('Customer access is required');
    }
    return this.nearby.count({ latitude, longitude });
  }
}
