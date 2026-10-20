import {
  Controller,
  ForbiddenException,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import {
  AdminAccessGuard,
  type AdminRequest,
} from '../auth/admin-access.guard.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

@ApiTags('Admin dashboard')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Admin access is required' })
@Controller('admin/dashboard')
@UseGuards(AdminAccessGuard)
export class AdminDashboardController {
  constructor(
    private readonly dashboard: AdminDashboardService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Read the admin dashboard summary' })
  @ApiOkResponse({ description: 'Current platform counts for the admin dashboard.' })
  summary(@Req() request: AdminRequest) {
    if (!request.admin) {
      throw new ForbiddenException('Admin access is required');
    }

    return this.dashboard.getSummary();
  }
}
