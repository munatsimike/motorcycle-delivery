import {
  Controller,
  ForbiddenException,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AdminAccessGuard,
  type AdminRequest,
} from '../auth/admin-access.guard.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

@Controller('admin/dashboard')
@UseGuards(AdminAccessGuard)
export class AdminDashboardController {
  constructor(
    private readonly dashboard: AdminDashboardService,
  ) {}

  @Get('summary')
  summary(@Req() request: AdminRequest) {
    if (!request.admin) {
      throw new ForbiddenException('Admin access is required');
    }

    return this.dashboard.getSummary();
  }
}
