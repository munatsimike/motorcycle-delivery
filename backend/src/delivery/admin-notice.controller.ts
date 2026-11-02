import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { AdminNoticeService } from './admin-notice.service.js';

@Controller('admin/notifications')
@UseGuards(AdminAccessGuard)
export class AdminNoticeController {
  constructor(private readonly notices: AdminNoticeService) {}

  @Get()
  list(@Req() request: AdminRequest, @Query() query: Record<string, unknown>) {
    if (!request.admin) {
      throw new ForbiddenException('Admin access is required');
    }
    return this.notices.list(query);
  }
}
