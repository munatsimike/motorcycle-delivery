import { Body, Controller, ForbiddenException, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import { ReceivingPreferenceBody, ReceivingPreferenceResponse } from '../openapi/schemas.js';
import { RiderAvailabilityService } from './rider-availability.service.js';

@ApiTags('Rider availability')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me')
@UseGuards(RiderAccessGuard)
export class RiderReceivingController {
  constructor(private readonly availability: RiderAvailabilityService) {}

  @Put('receiving')
  @HttpCode(200)
  @ApiOperation({ summary: 'Match receiving requests to online or offline' })
  @ApiBody({ type: ReceivingPreferenceBody })
  @ApiOkResponse({ type: ReceivingPreferenceResponse })
  receiving(@Req() request: RiderRequest, @Body() body: unknown) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    return this.availability.setReceiving(request.rider, body);
  }
}
