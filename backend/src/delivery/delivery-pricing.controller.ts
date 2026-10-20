import { Body, Controller, ForbiddenException, Get, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { DeliveryPricingBody, DeliveryPricingResponse } from '../openapi/schemas.js';
import { DeliveryPricingService } from './delivery-pricing.service.js';

@ApiTags('Admin delivery pricing')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Admin access is required' })
@Controller('admin/delivery-pricing')
@UseGuards(AdminAccessGuard)
export class DeliveryPricingController {
  constructor(private readonly pricing: DeliveryPricingService) {}

  @Get()
  @ApiOperation({ summary: 'Read the active delivery tariff' })
  @ApiOkResponse({ type: DeliveryPricingResponse })
  @ApiNotFoundResponse({ description: 'Delivery pricing is not configured' })
  current(@Req() request: AdminRequest) {
    requiredAdmin(request);
    return this.pricing.current();
  }

  @Put()
  @HttpCode(200)
  @ApiOperation({ summary: 'Replace the active delivery tariff' })
  @ApiBody({ type: DeliveryPricingBody })
  @ApiOkResponse({ type: DeliveryPricingResponse, description: 'The new active tariff, or the current tariff when the submitted values are unchanged.' })
  replace(@Req() request: AdminRequest, @Body() body: unknown) {
    const admin = requiredAdmin(request);
    return this.pricing.replace(admin, body);
  }
}

function requiredAdmin(request: AdminRequest) {
  if (!request.admin) {
    throw new ForbiddenException('Admin access is required');
  }
  return request.admin;
}
