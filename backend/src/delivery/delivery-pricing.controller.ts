import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { ClassTariffBody, ClassTariffResponse, ClassTariffsResponse, DeliveryPricingBody, DeliveryPricingResponse, PricingAuditPage, WindowEnabledBody } from '../openapi/schemas.js';
import { ClassPricingService } from './class-pricing.service.js';
import { DeliveryPricingService } from './delivery-pricing.service.js';

@ApiTags('Admin delivery pricing')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Admin access is required' })
@Controller('admin/delivery-pricing')
@UseGuards(AdminAccessGuard)
export class DeliveryPricingController {
  constructor(
    private readonly pricing: DeliveryPricingService,
    private readonly classPricing: ClassPricingService,
  ) {}

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

  @Get('classes')
  @ApiOperation({ summary: 'Read the active Express and Flexible tariffs' })
  @ApiOkResponse({ type: ClassTariffsResponse })
  currentClasses(@Req() request: AdminRequest) {
    requiredAdmin(request);
    return this.classPricing.currentClasses();
  }

  @Get('audits')
  @ApiOperation({ summary: 'List pricing publication history' })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiOkResponse({ type: PricingAuditPage })
  auditHistory(@Req() request: AdminRequest, @Query() query: Record<string, unknown>) {
    requiredAdmin(request);
    return this.classPricing.audits(query);
  }

  @Get('classes/:serviceClass')
  @ApiOperation({ summary: 'Read the active tariff for Express or Flexible' })
  @ApiParam({ name: 'serviceClass', enum: ['EXPRESS', 'FLEXIBLE'] })
  @ApiOkResponse({ type: ClassTariffResponse })
  @ApiNotFoundResponse({ description: 'That service class has no published tariff' })
  classTariff(@Req() request: AdminRequest, @Param('serviceClass') serviceClass: string) {
    requiredAdmin(request);
    return this.classPricing.currentClass(serviceClass);
  }

  @Post('classes/:serviceClass')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish a new Express or Flexible tariff version' })
  @ApiParam({ name: 'serviceClass', enum: ['EXPRESS', 'FLEXIBLE'] })
  @ApiBody({ type: ClassTariffBody })
  @ApiOkResponse({ type: ClassTariffResponse })
  publish(@Req() request: AdminRequest, @Param('serviceClass') serviceClass: string, @Body() body: unknown) {
    return this.classPricing.publish(requiredAdmin(request), serviceClass, body);
  }

  @Post('classes/:serviceClass/windows/:windowId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enable or disable a pricing window by publishing the next version' })
  @ApiParam({ name: 'serviceClass', enum: ['EXPRESS', 'FLEXIBLE'] })
  @ApiParam({ name: 'windowId', format: 'uuid' })
  @ApiBody({ type: WindowEnabledBody })
  @ApiOkResponse({ type: ClassTariffResponse })
  setWindowEnabled(
    @Req() request: AdminRequest,
    @Param('serviceClass') serviceClass: string,
    @Param('windowId') windowId: string,
    @Body() body: unknown,
  ) {
    return this.classPricing.setWindowEnabled(requiredAdmin(request), serviceClass, windowId, body);
  }
}

function requiredAdmin(request: AdminRequest) {
  if (!request.admin) {
    throw new ForbiddenException('Admin access is required');
  }
  return request.admin;
}
