import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { AdminDeliveryListService } from './admin-delivery-list.service.js';

@Controller('admin/deliveries')
@UseGuards(AdminAccessGuard)
export class AdminDeliveryController {
  constructor(private readonly deliveries: AdminDeliveryListService) {}

  @Get()
  list(@Req() request: AdminRequest, @Query() query: Record<string, unknown>) {
    if (!request.admin) {
      throw new ForbiddenException('Admin access is required');
    }

    return this.deliveries.list(query);
  }
}
