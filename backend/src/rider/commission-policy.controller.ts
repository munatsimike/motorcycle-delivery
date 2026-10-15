import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AdminAccessGuard,
  type AdminRequest,
} from '../auth/admin-access.guard.js';
import { CommissionPolicyService } from './commission-policy.service.js';

@Controller('admin/commission-policy')
@UseGuards(AdminAccessGuard)
export class CommissionPolicyController {
  constructor(private readonly policies: CommissionPolicyService) {}

  @Get()
  current(@Req() request: AdminRequest) {
    requiredAdmin(request);
    return this.policies.current();
  }

  @Put()
  @HttpCode(200)
  replace(@Req() request: AdminRequest, @Body() body: unknown) {
    const admin = requiredAdmin(request);
    return this.policies.replace(admin, body);
  }
}

function requiredAdmin(request: AdminRequest) {
  if (!request.admin) {
    throw new ForbiddenException('Admin access is required');
  }

  return request.admin;
}