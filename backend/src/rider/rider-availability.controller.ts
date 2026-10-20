import { Controller, ForbiddenException, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import { AvailabilityResponse } from '../openapi/schemas.js';
import { RiderAvailabilityService } from './rider-availability.service.js';

@ApiTags('Rider availability')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me/availability')
@UseGuards(RiderAccessGuard)
export class RiderAvailabilityController {
  constructor(private readonly availability: RiderAvailabilityService) {}

  @Post('online')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark the rider available for offers' })
  @ApiOkResponse({ type: AvailabilityResponse })
  online(@Req() request: RiderRequest) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    return this.availability.online(request.rider);
  }

  @Post('offline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark the rider offline' })
  @ApiOkResponse({ type: AvailabilityResponse })
  offline(@Req() request: RiderRequest) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    return this.availability.offline(request.rider);
  }
}
