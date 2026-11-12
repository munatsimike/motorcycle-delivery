import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { TooManyRequestsException } from '../auth/too-many-requests.exception.js';
import { rateLimitAddress } from '../http/client-address.js';
import { RegistrationPlaceLimiter } from './registration-address-limit.js';
import { PlacesService, readSearchBias } from './places.service.js';

@ApiTags('Address search')
@Controller('auth/places')
export class RegistrationAddressController {
  constructor(
    private readonly places: PlacesService,
    private readonly limiter: RegistrationPlaceLimiter,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Search addresses while filling in a registration form' })
  @ApiQuery({ name: 'text', required: true, schema: { type: 'string' } })
  @ApiQuery({ name: 'latitude', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'longitude', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'sessionToken', required: false, schema: { type: 'string' } })
  @ApiOkResponse({ description: 'Place predictions. No account or session is required.' })
  @ApiTooManyRequestsResponse({ description: 'Too many address searches from this network.' })
  search(
    @Req() request: Request,
    @Query('text') text: unknown,
    @Query('latitude') latitude: unknown,
    @Query('longitude') longitude: unknown,
    @Query('sessionToken') sessionToken: unknown,
  ) {
    this.consume(request);
    return this.places.search(
      typeof text === 'string' ? text : '',
      readSearchBias(latitude, longitude),
      typeof sessionToken === 'string' ? sessionToken : '',
    );
  }

  @Get('detail')
  @ApiOperation({ summary: 'Read one address selected on a registration form' })
  @ApiQuery({ name: 'placeId', required: true, schema: { type: 'string' } })
  @ApiQuery({ name: 'sessionToken', required: false, schema: { type: 'string' } })
  @ApiOkResponse({ description: 'The selected address and coordinates.' })
  @ApiTooManyRequestsResponse({ description: 'Too many address searches from this network.' })
  detail(
    @Req() request: Request,
    @Query('placeId') placeId: unknown,
    @Query('sessionToken') sessionToken: unknown,
  ) {
    this.consume(request);
    return this.places.place(
      typeof placeId === 'string' ? placeId : '',
      typeof sessionToken === 'string' ? sessionToken : '',
    );
  }

  private consume(request: Request): void {
    const address = rateLimitAddress(
      request,
      process.env.TRUSTED_PROXY_CIDRS,
      process.env.TRUST_RAILWAY_EDGE_CLIENT_IP,
    );
    if (!this.limiter.allow(address)) {
      throw new TooManyRequestsException('Address search is temporarily unavailable. You can type the address.');
    }
  }
}
