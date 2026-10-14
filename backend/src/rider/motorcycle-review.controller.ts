import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { MotorcycleListService } from './motorcycle-list.service.js';
import { MotorcycleReviewService, type VerificationDecision } from './motorcycle-review.service.js';

@Controller('admin/motorcycles')
@UseGuards(AdminAccessGuard)
export class MotorcycleReviewController {
  constructor(
    private readonly reviews: MotorcycleReviewService,
    private readonly motorcycleList: MotorcycleListService,
  ) {}

  @Get()
  listMotorcycles(@Query() query: Record<string, unknown>) {
    return this.motorcycleList.list(query);
  }
  @Post(':id/verification')
  @HttpCode(200)
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

