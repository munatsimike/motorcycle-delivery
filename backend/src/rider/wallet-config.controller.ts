import { Body, Controller, ForbiddenException, Get, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { WalletConfigService } from './wallet-config.service.js';

@Controller('admin/wallet-config')
@UseGuards(AdminAccessGuard)
export class WalletConfigController {
  constructor(private readonly wallets: WalletConfigService) {}

  @Get()
  current(@Req() request: AdminRequest) {
    requiredAdmin(request);
    return this.wallets.current();
  }

  @Put()
  @HttpCode(200)
  replace(@Req() request: AdminRequest, @Body() body: unknown) {
    const admin = requiredAdmin(request);
    return this.wallets.replace(admin, body);
  }
}

function requiredAdmin(request: AdminRequest) {
  if (!request.admin) {
    throw new ForbiddenException('Admin access is required');
  }
  return request.admin;
}
