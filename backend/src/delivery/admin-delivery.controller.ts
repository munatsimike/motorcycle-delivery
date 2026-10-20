import { Controller, ForbiddenException, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { AdminDeliveryListService } from './admin-delivery-list.service.js';

@ApiTags('Admin deliveries')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Admin access is required' })
@Controller('admin/deliveries')
@UseGuards(AdminAccessGuard)
export class AdminDeliveryController {
  constructor(private readonly deliveries: AdminDeliveryListService) {}

  @Get()
  @ApiOperation({ summary: 'List deliveries' })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiQuery({ name: 'status', required: false, schema: { type: 'string' } })
  @ApiOkResponse({ description: 'A page of deliveries.' })
  list(@Req() request: AdminRequest, @Query() query: Record<string, unknown>) {
    if (!request.admin) {
      throw new ForbiddenException('Admin access is required');
    }

    return this.deliveries.list(query);
  }

  @Get(':deliveryId')
  @ApiOperation({ summary: 'Read one delivery' })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiOkResponse({ description: 'The delivery record.' })
  getById(
    @Req() request: AdminRequest,
    @Param('deliveryId') deliveryId: string,
  ) {
    if (!request.admin) {
      throw new ForbiddenException('Admin access is required');
    }

    return this.deliveries.getById(deliveryId);
  }
}
