import { Body, Controller, ForbiddenException, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { DispatchService } from './dispatch.service.js';

@Controller('riders/me/deliveries')
@UseGuards(RiderAccessGuard)
export class RiderDeliveryController {
  constructor(private readonly dispatch: DispatchService) {}

  @Post(':deliveryId/status')
  @HttpCode(200)
  updateStatus(@Req() request: RiderRequest, @Param('deliveryId') deliveryId: string, @Body() body: unknown) {
    return this.dispatch.progress(requiredRider(request), deliveryId, body);
  }
}

function requiredRider(request: RiderRequest): RiderContext {
  if (!request.rider) {
    throw new ForbiddenException('Rider access is required');
  }
  return request.rider;
}
