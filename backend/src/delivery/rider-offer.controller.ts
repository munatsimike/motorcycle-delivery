import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { ReleaseOfferBody } from '../openapi/schemas.js';
import { DispatchService } from './dispatch.service.js';

type OfferRequest = RiderRequest & {
  headers?: RiderRequest['headers'] & { 'idempotency-key'?: string | string[] };
};

@ApiTags('Rider offers')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me/offers')
@UseGuards(RiderAccessGuard)
export class RiderOfferController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get()
  @ApiOperation({ summary: 'List open delivery offers for the signed-in rider' })
  @ApiOkResponse({ description: 'Offers that are still inside their acceptance window.' })
  list(@Req() request: OfferRequest) {
    return this.dispatch.listOffers(requiredRider(request));
  }

  @Post(':assignmentId/acceptance')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept an open delivery offer' })
  @ApiParam({ name: 'assignmentId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable key for this acceptance. Reuse it if the response is lost.' })
  @ApiOkResponse({ description: 'The accepted assignment. A repeated key returns the same result.' })
  accept(@Req() request: OfferRequest, @Param('assignmentId') assignmentId: string) {
    return this.dispatch.accept(requiredRider(request), assignmentId, readIdempotencyKey(request));
  }

  @Post(':assignmentId/release')
  @HttpCode(200)
  @ApiOperation({ summary: 'Release an accepted delivery before pickup is complete' })
  @ApiParam({ name: 'assignmentId', format: 'uuid' })
  @ApiBody({ type: ReleaseOfferBody })
  @ApiOkResponse({ description: 'The delivery was released and search can continue.' })
  release(@Req() request: OfferRequest, @Param('assignmentId') assignmentId: string, @Body() body: unknown) {
    return this.dispatch.release(requiredRider(request), assignmentId, body);
  }
}

function requiredRider(request: OfferRequest): RiderContext {
  if (!request.rider) {
    throw new ForbiddenException('Rider access is required');
  }
  return request.rider;
}

function readIdempotencyKey(request: OfferRequest): string {
  const header = request.headers?.['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException('Enter an idempotency key');
  }
  return value.trim();
}
