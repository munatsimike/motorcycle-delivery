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
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import {
  AdminAccessGuard,
  type AdminRequest,
} from '../auth/admin-access.guard.js';
import { CommissionPolicyBody, CommissionPolicyResponse } from '../openapi/schemas.js';
import { CommissionPolicyService } from './commission-policy.service.js';

@ApiTags('Admin commission')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Admin access is required' })
@Controller('admin/commission-policy')
@UseGuards(AdminAccessGuard)
export class CommissionPolicyController {
  constructor(private readonly policies: CommissionPolicyService) {}

  @Get()
  @ApiOperation({ summary: 'Read the active commission policy' })
  @ApiOkResponse({ type: CommissionPolicyResponse })
  @ApiNotFoundResponse({ description: 'Active commission policy not found' })
  current(@Req() request: AdminRequest) {
    requiredAdmin(request);
    return this.policies.current();
  }

  @Put()
  @HttpCode(200)
  @ApiOperation({ summary: 'Replace the active commission policy' })
  @ApiBody({ type: CommissionPolicyBody })
  @ApiOkResponse({ type: CommissionPolicyResponse })
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