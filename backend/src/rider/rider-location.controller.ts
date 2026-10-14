import { Body, Controller, ForbiddenException, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { RiderLocationService } from './rider-location.service.js';

@Controller('riders/me/location')
@UseGuards(RiderAccessGuard)
export class RiderLocationController {
  constructor(private readonly locations: RiderLocationService) {}

  @Put()
  @HttpCode(200)
  update(@Req() request: RiderRequest, @Body() body: unknown) {
    return this.locations.update(requiredRider(request), body);
  }
}

function requiredRider(request: RiderRequest): RiderContext {
  if (!request.rider) {
    throw new ForbiddenException('Rider access is required');
  }
  return request.rider;
}
