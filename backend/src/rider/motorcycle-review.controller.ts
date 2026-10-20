import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { MotorcycleVerificationBody } from '../openapi/schemas.js';
import { MotorcycleListService } from './motorcycle-list.service.js';
import { MotorcycleReviewService, type VerificationDecision } from './motorcycle-review.service.js';

@ApiTags('Admin motorcycles')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Admin access is required' })
@Controller('admin/motorcycles')
@UseGuards(AdminAccessGuard)
export class MotorcycleReviewController {
  constructor(
    private readonly reviews: MotorcycleReviewService,
    private readonly motorcycleList: MotorcycleListService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List motorcycles awaiting or holding verification' })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiQuery({ name: 'verificationStatus', required: false, schema: { type: 'string', enum: ['PENDING', 'VERIFIED', 'REJECTED', 'REVOKED'] } })
  @ApiQuery({ name: 'registrationNumber', required: false, schema: { type: 'string' } })
  @ApiOkResponse({ description: 'A page of motorcycles.' })
  listMotorcycles(@Query() query: Record<string, unknown>) {
    return this.motorcycleList.list(query);
  }
  @Post(':id/verification')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify, reject, or revoke a motorcycle' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: MotorcycleVerificationBody })
  @ApiOkResponse({ description: 'The motorcycle verification state after the decision.' })
  review(@Req() request: AdminRequest, @Param('id') motorcycleId: string, @Body() body: unknown) {
    if (!request.admin) {
      throw new ForbiddenException('Admin access is required');
    }
    return this.reviews.review(request.admin, motorcycleId, readDecision(body));
  }
}

function readDecision(body: unknown): VerificationDecision {
  if (typeof body !== 'object' || body === null || !('decision' in body)) {
    throw new BadRequestException('Choose a verification decision');
  }
  const decision = (body as { decision: unknown }).decision;
  if (decision !== 'VERIFY' && decision !== 'REJECT' && decision !== 'REVOKE') {
    throw new BadRequestException('Choose a verification decision');
  }
  return decision;
}

