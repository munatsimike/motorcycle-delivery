import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { DispatchService } from './dispatch.service.js';

type AssignmentRequest = RiderRequest & {
  headers?: RiderRequest['headers'] & { 'idempotency-key'?: string | string[] };
};

@ApiTags('Rider deliveries')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me/assignments')
@UseGuards(RiderAccessGuard)
export class RiderAssignmentController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get()
  @ApiOperation({ summary: 'Read the rider live accepted assignments' })
  @ApiOkResponse({ description: 'Every accepted delivery still in progress for this rider, oldest first.' })
  list(@Req() request: RiderRequest) {
    return this.dispatch.liveAssignments(requiredRider(request));
  }

  @Get('active')
  @ApiOperation({ summary: 'Read the rider active assignment' })
  @ApiOkResponse({ description: 'The accepted delivery, or assignment null when the rider has none.' })
  active(@Req() request: RiderRequest) {
    return this.dispatch.activeAssignment(requiredRider(request));
  }

  @Post(':assignmentId/cancellation')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an assigned V2 delivery before pickup and reopen the original request' })
  @ApiParam({ name: 'assignmentId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' }, note: { type: 'string' } } } })
  @ApiOkResponse({ description: 'The assignment ended. The original delivery reopens when the deadline remains.' })
  cancel(@Req() request: AssignmentRequest, @Param('assignmentId') assignmentId: string, @Body() body: unknown) {
    return this.dispatch.cancelBeforePickup(requiredRider(request), assignmentId, readIdempotencyKey(request), body);
  }
}

function readIdempotencyKey(request: AssignmentRequest): string {
  const header = request.headers?.['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException('Enter an idempotency key');
  }
  return value.trim();
}

function requiredRider(request: RiderRequest): RiderContext {
  if (!request.rider) {
    throw new ForbiddenException('Rider access is required');
  }
  return request.rider;
}
