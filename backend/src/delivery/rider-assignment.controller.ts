import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { DispatchService } from './dispatch.service.js';

@ApiTags('Rider deliveries')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me/assignments')
@UseGuards(RiderAccessGuard)
export class RiderAssignmentController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get('active')
  @ApiOperation({ summary: 'Read the rider active assignment' })
  @ApiOkResponse({ description: 'The accepted delivery, or assignment null when the rider has none.' })
  active(@Req() request: RiderRequest) {
    return this.dispatch.activeAssignment(requiredRider(request));
  }
}

function requiredRider(request: RiderRequest): RiderContext {
  if (!request.rider) {
    throw new ForbiddenException('Rider access is required');
  }
  return request.rider;
}
