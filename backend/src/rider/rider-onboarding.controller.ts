import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import { RiderOnboardingService } from './rider-onboarding.service.js';

@Controller('riders/me')
@UseGuards(RiderAccessGuard)
export class RiderOnboardingController {
  constructor(private readonly onboarding: RiderOnboardingService) {}

  @Get('onboarding')
  current(@Req() request: RiderRequest) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    return this.onboarding.current(request.rider);
  }
}
