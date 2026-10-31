import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { AdminCustomerListService } from './admin-customer-list.service.js';

@ApiTags('Admin customers')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Admin access is required' })
@Controller('admin/customers')
@UseGuards(AdminAccessGuard)
export class AdminCustomerController {
  constructor(private readonly customers: AdminCustomerListService) {}

  @Get()
  @ApiOperation({ summary: 'List registered customers' })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiOkResponse({ description: 'A page of registered customer accounts.' })
  list(@Req() request: AdminRequest, @Query() query: Record<string, unknown>) {
    if (!request.admin) {
      throw new ForbiddenException('Admin access is required');
    }
    return this.customers.list(query);
  }
}
