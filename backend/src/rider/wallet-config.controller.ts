import { Body, Controller, ForbiddenException, Get, HttpCode, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { WalletConfigBody, WalletConfigResponse } from '../openapi/schemas.js';
import { WalletConfigService } from './wallet-config.service.js';
import { WalletService } from './wallet.service.js';

@ApiTags('Admin wallet')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Admin access is required' })
@Controller('admin/wallet-config')
@UseGuards(AdminAccessGuard)
export class WalletConfigController {
  constructor(private readonly wallets: WalletConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Read the active wallet configuration' })
  @ApiOkResponse({ type: WalletConfigResponse })
  current(@Req() request: AdminRequest) {
    requiredAdmin(request);
    return this.wallets.current();
  }

  @Put()
  @HttpCode(200)
  @ApiOperation({ summary: 'Replace the active wallet configuration' })
  @ApiBody({ type: WalletConfigBody })
  @ApiOkResponse({ type: WalletConfigResponse })
  replace(@Req() request: AdminRequest, @Body() body: unknown) {
    const admin = requiredAdmin(request);
    return this.wallets.replace(admin, body);
  }

  @Get('audits')
  @ApiOperation({ summary: 'List wallet configuration history' })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiOkResponse({ description: 'Paginated wallet configuration audits. Read only.' })
  audits(@Req() request: AdminRequest, @Query() query: Record<string, unknown>) {
    requiredAdmin(request);
    return this.wallets.audits(query);
  }
}

@ApiTags('Admin wallet')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Admin access is required' })
@Controller('admin/wallet-borrowing-limit-audits')
@UseGuards(AdminAccessGuard)
export class WalletBorrowingLimitAuditController {
  constructor(private readonly wallets: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'List negative wallet limit changes' })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiQuery({ name: 'riderProfileId', required: false })
  @ApiQuery({ name: 'actorId', required: false })
  @ApiOkResponse({ description: 'Paginated borrowing-limit audits. Read only.' })
  list(@Req() request: AdminRequest, @Query() query: Record<string, unknown>) {
    requiredAdmin(request);
    return this.wallets.borrowingLimitAudits(query);
  }
}

function requiredAdmin(request: AdminRequest) {
  if (!request.admin) {
    throw new ForbiddenException('Admin access is required');
  }
  return request.admin;
}
