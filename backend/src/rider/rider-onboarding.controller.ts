import { Body, Controller, ForbiddenException, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import { RiderOnboardingResponse, RiderSelfProfileResponse } from '../openapi/schemas.js';
import { RiderOnboardingService } from './rider-onboarding.service.js';

@ApiTags('Rider profile')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me')
@UseGuards(RiderAccessGuard)
export class RiderOnboardingController {
  constructor(private readonly onboarding: RiderOnboardingService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Read the signed-in rider name, verified phone, and registration address' })
  @ApiOkResponse({ type: RiderSelfProfileResponse })
  profile(@Req() request: RiderRequest) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    return this.onboarding.profile(request.rider);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Change only the signed-in rider address' })
  @ApiOkResponse({ type: RiderSelfProfileResponse })
  updateAddress(@Req() request: RiderRequest, @Body() body: unknown) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    return this.onboarding.updateAddress(request.rider, body);
  }

  @Get('onboarding')
  @ApiOperation({ summary: 'Read rider approval, licence, and motorcycle readiness' })
  @ApiOkResponse({ type: RiderOnboardingResponse })
  current(@Req() request: RiderRequest) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    return this.onboarding.current(request.rider);
  }
}
