import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CustomerAccessGuard, type CustomerRequest } from '../auth/customer-access.guard.js';
import { NearbyRidersService } from './nearby-riders.service.js';

@ApiTags('Customer deliveries')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Customer access is required' })
@Controller('customers/me/riders')
@UseGuards(CustomerAccessGuard)
export class NearbyRidersController {
  constructor(private readonly nearby: NearbyRidersService) {}

  @Get('nearby')
  @ApiOperation({ summary: 'Count available riders near a coordinate' })
  @ApiQuery({ name: 'latitude', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'longitude', required: false, schema: { type: 'string' } })
  @ApiOkResponse({ description: 'The nearby available rider count.' })
  count(
    @Req() request: CustomerRequest,
    @Query('latitude') latitude?: string,
    @Query('longitude') longitude?: string,
  ) {
    if (!request.customer) {
      throw new ForbiddenException('Customer access is required');
    }
    return this.nearby.count({ latitude, longitude });
  }
}
