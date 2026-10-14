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
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { DispatchService } from './dispatch.service.js';

type OfferRequest = RiderRequest & {
  headers?: RiderRequest['headers'] & { 'idempotency-key'?: string | string[] };
};

@Controller('riders/me/offers')
@UseGuards(RiderAccessGuard)
export class RiderOfferController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get()
  list(@Req() request: OfferRequest) {
    return this.dispatch.listOffers(requiredRider(request));
  }

  @Post(':assignmentId/acceptance')
  @HttpCode(200)
  accept(@Req() request: OfferRequest, @Param('assignmentId') assignmentId: string) {
    return this.dispatch.accept(requiredRider(request), assignmentId, readIdempotencyKey(request));
  }

  @Post(':assignmentId/release')
  @HttpCode(200)
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
