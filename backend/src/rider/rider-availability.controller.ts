import { Controller, ForbiddenException, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import { RiderAvailabilityService } from './rider-availability.service.js';

@Controller('riders/me/availability')
@UseGuards(RiderAccessGuard)
export class RiderAvailabilityController {
  constructor(private readonly availability: RiderAvailabilityService) {}

  @Post('online')
  @HttpCode(200)
  online(@Req() request: RiderRequest) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    return this.availability.online(request.rider);
  }

  @Post('offline')
  @HttpCode(200)
  offline(@Req() request: RiderRequest) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    return this.availability.offline(request.rider);
  }
}
