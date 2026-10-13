import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { LicenceReviewService, readLicenceReview } from './licence-review.service.js';
import { readApprovalDecision, RiderApprovalService } from './rider-approval.service.js';

@Controller('admin/riders')
@UseGuards(AdminAccessGuard)
export class RiderAdminController {
  constructor(
    private readonly licences: LicenceReviewService,
    private readonly approvals: RiderApprovalService,
  ) {}

  @Post(':riderProfileId/licence-verification')
  @HttpCode(200)
  verifyLicence(@Req() request: AdminRequest, @Param('riderProfileId') riderProfileId: string, @Body() body: unknown) {
    const admin = requiredAdmin(request);
    return this.licences.review(admin, riderProfileId, readLicenceReview(body));
  }

  @Get(':riderProfileId/licence-image')
  @Header('Cache-Control', 'private, no-store')
  async licenceImage(@Req() request: AdminRequest, @Param('riderProfileId') riderProfileId: string) {
    requiredAdmin(request);
    const image = await this.licences.currentImage(riderProfileId);
    return new StreamableFile(image.bytes, {
      type: image.contentType,
      disposition: 'inline',
    });
  }

  @Post(':riderProfileId/approval')
  @HttpCode(200)
  approval(@Req() request: AdminRequest, @Param('riderProfileId') riderProfileId: string, @Body() body: unknown) {
    const admin = requiredAdmin(request);
    return this.approvals.decide(admin, riderProfileId, readApprovalDecision(body));
  }
}

function requiredAdmin(request: AdminRequest) {
  if (!request.admin) {
    throw new ForbiddenException('Admin access is required');
  }
  return request.admin;
}
