import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { V2CommissionAuditPage, V2CommissionRateBody, V2CommissionRateResponse } from '../openapi/schemas.js';
import { V2CommissionRateService } from './v2-commission-rate.service.js';

@ApiTags('Admin V2 commission')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Admin access is required' })
@Controller('admin/v2-commission-rate')
@UseGuards(AdminAccessGuard)
export class V2CommissionRateController {
  constructor(private readonly rates: V2CommissionRateService) {}

  @Get()
  @ApiOperation({ summary: 'Read the active global V2 commission percentage' })
  @ApiOkResponse({ type: V2CommissionRateResponse })
  current(@Req() request: AdminRequest) {
    requiredAdmin(request);
    return this.rates.current();
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish a global V2 commission percentage' })
  @ApiBody({ type: V2CommissionRateBody })
  @ApiOkResponse({ type: V2CommissionRateResponse, description: 'The published rate. An unchanged percentage returns the current rate and writes no new version.' })
  publish(@Req() request: AdminRequest, @Body() body: unknown) {
    return this.rates.publish(requiredAdmin(request), body);
  }

  @Get('audits')
  @ApiOperation({ summary: 'List V2 commission publication history' })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiOkResponse({ type: V2CommissionAuditPage })
  audits(@Req() request: AdminRequest, @Query() query: Record<string, unknown>) {
    requiredAdmin(request);
    return this.rates.audits(query);
  }
}

function requiredAdmin(request: AdminRequest) {
  if (!request.admin) {
    throw new ForbiddenException('Admin access is required');
  }
  return request.admin;
}
