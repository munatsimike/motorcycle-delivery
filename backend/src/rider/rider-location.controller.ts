import { Body, Controller, ForbiddenException, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { LocationBody, LocationResponse } from '../openapi/schemas.js';
import { RiderLocationService } from './rider-location.service.js';

@ApiTags('Rider availability')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me/location')
@UseGuards(RiderAccessGuard)
export class RiderLocationController {
  constructor(private readonly locations: RiderLocationService) {}

  @Put()
  @HttpCode(200)
  @ApiOperation({ summary: 'Report the rider current location' })
  @ApiBody({ type: LocationBody })
  @ApiOkResponse({ type: LocationResponse })
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
