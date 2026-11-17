import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { ExchangeRateService } from './exchange-rate.service.js';

@Controller('admin/exchange-rate')
@UseGuards(AdminAccessGuard)
export class ExchangeRateController {
  constructor(private readonly rates: ExchangeRateService) {}

  @Get()
  current(@Req() request: AdminRequest) {
    requiredAdmin(request);
    return this.rates.current();
  }

  @Post()
  @HttpCode(200)
  publish(@Req() request: AdminRequest, @Body() body: unknown) {
    return this.rates.publish(requiredAdmin(request), body);
  }

  @Get('audits')
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
