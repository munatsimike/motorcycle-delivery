import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { DispatchService } from './dispatch.service.js';

@Controller('riders/me/assignments')
@UseGuards(RiderAccessGuard)
export class RiderAssignmentController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get('active')
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
