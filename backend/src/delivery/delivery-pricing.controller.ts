import { Body, Controller, ForbiddenException, Get, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { DeliveryPricingService } from './delivery-pricing.service.js';

@Controller('admin/delivery-pricing')
@UseGuards(AdminAccessGuard)
export class DeliveryPricingController {
  constructor(private readonly pricing: DeliveryPricingService) {}

  @Get()
  current(@Req() request: AdminRequest) {
    requiredAdmin(request);
    return this.pricing.current();
  }

  @Put()
  @HttpCode(200)
  replace(@Req() request: AdminRequest, @Body() body: unknown) {
    const admin = requiredAdmin(request);
    return this.pricing.replace(admin, body);
  }
}

function requiredAdmin(request: AdminRequest) {
  if (!request.admin) {
    throw new ForbiddenException('Admin access is required');
  }
  return request.admin;
}
