import { Body, Controller, ForbiddenException, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConflictResponse, ApiForbiddenResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { DeliveryProgressResponse, DeliveryStatusBody } from '../openapi/schemas.js';
import { DispatchService } from './dispatch.service.js';

type StatusRequest = RiderRequest & {
  headers?: RiderRequest['headers'] & { 'idempotency-key'?: string | string[] };
};

@ApiTags('Rider deliveries')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me/deliveries')
@UseGuards(RiderAccessGuard)
export class RiderDeliveryController {
  constructor(private readonly dispatch: DispatchService) {}

  @Post(':deliveryId/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Advance an accepted delivery to its next status' })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Required when the accepted delivery has a V2 bid snapshot.' })
  @ApiBody({ type: DeliveryStatusBody })
  @ApiOkResponse({ type: DeliveryProgressResponse })
  @ApiConflictResponse({ description: 'This delivery status cannot be changed' })
  updateStatus(@Req() request: StatusRequest, @Param('deliveryId') deliveryId: string, @Body() body: unknown) {
    return this.dispatch.progress(requiredRider(request), deliveryId, body, new Date(), optionalIdempotencyKey(request));
  }
}

function optionalIdempotencyKey(request: StatusRequest): string | undefined {
  const header = request.headers?.['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' ? value : undefined;
}

function requiredRider(request: RiderRequest): RiderContext {
  if (!request.rider) {
    throw new ForbiddenException('Rider access is required');
  }
  return request.rider;
}
