import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Query,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiForbiddenResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags, ApiUnauthorizedResponse, getSchemaPath } from '@nestjs/swagger';
import { AdminAccessGuard, type AdminRequest } from '../auth/admin-access.guard.js';
import { ApprovalBody, LicenceRejectBody, LicenceVerifyBody, WalletTopUpBody } from '../openapi/schemas.js';
import { LicenceReviewService, readLicenceReview } from './licence-review.service.js';
import { readApprovalDecision, RiderApprovalService } from './rider-approval.service.js';
import { WalletService } from './wallet.service.js';
import { RiderListService } from './rider-list.service.js';

@ApiTags('Admin riders')
@ApiBearerAuth('bearer')
@ApiExtraModels(LicenceVerifyBody, LicenceRejectBody)
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Admin access is required' })
@Controller('admin/riders')
@UseGuards(AdminAccessGuard)
export class RiderAdminController {
  constructor(
    private readonly licences: LicenceReviewService,
    private readonly approvals: RiderApprovalService,
    private readonly wallets: WalletService,
    private readonly riderList: RiderListService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List riders' })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiQuery({ name: 'approvalStatus', required: false, schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED'] } })
  @ApiQuery({ name: 'verificationStatus', required: false, schema: { type: 'string', enum: ['PENDING', 'VERIFIED', 'REJECTED'] } })
  @ApiQuery({ name: 'phone', required: false, schema: { type: 'string' } })
  @ApiOkResponse({ description: 'A page of rider profiles.' })
  listRiders(@Query() query: Record<string, unknown>) {
    return this.riderList.list(query);
  }
  @Get(':riderProfileId')
  @ApiOperation({ summary: 'Read one rider profile' })
  @ApiParam({ name: 'riderProfileId', format: 'uuid' })
  @ApiOkResponse({ description: 'The rider profile and verification state.' })
  getRiderDetails(@Param('riderProfileId', new ParseUUIDPipe({ version: '7' })) riderProfileId: string) {
    return this.riderList.getById(riderProfileId);
  }
  @Post(':riderProfileId/licence-verification')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify or reject a rider licence image' })
  @ApiParam({ name: 'riderProfileId' })
  @ApiBody({
    schema: { oneOf: [{ $ref: getSchemaPath(LicenceVerifyBody) }, { $ref: getSchemaPath(LicenceRejectBody) }] },
  })
  @ApiOkResponse({ description: 'The licence review result.' })
  verifyLicence(@Req() request: AdminRequest, @Param('riderProfileId') riderProfileId: string, @Body() body: unknown) {
    const admin = requiredAdmin(request);
    return this.licences.review(admin, riderProfileId, readLicenceReview(body));
  }

  @Get(':riderProfileId/licence-image')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Download the rider licence image' })
  @ApiParam({ name: 'riderProfileId' })
  @ApiOkResponse({ description: 'The private licence image.', content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } })
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
  @ApiOperation({ summary: 'Approve or suspend a rider' })
  @ApiParam({ name: 'riderProfileId' })
  @ApiBody({ type: ApprovalBody })
  @ApiOkResponse({ description: 'The rider approval state after the decision.' })
  approval(@Req() request: AdminRequest, @Param('riderProfileId') riderProfileId: string, @Body() body: unknown) {
    const admin = requiredAdmin(request);
    return this.approvals.decide(admin, riderProfileId, readApprovalDecision(body));
  }

  @Post(':riderProfileId/wallet/top-ups')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record a manual wallet top-up' })
  @ApiParam({ name: 'riderProfileId' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable key for this top-up. Reuse it if the response is lost.' })
  @ApiBody({ type: WalletTopUpBody })
  @ApiOkResponse({ description: 'The recorded top-up. Repeating the same key does not credit the wallet twice.' })
  topUp(@Req() request: AdminRequest, @Param('riderProfileId') riderProfileId: string, @Body() body: unknown) {
    const admin = requiredAdmin(request);
    return this.wallets.topUp(admin, riderProfileId, body, readIdempotencyKey(request));
  }
}

function requiredAdmin(request: AdminRequest) {
  if (!request.admin) {
    throw new ForbiddenException('Admin access is required');
  }
  return request.admin;
}

function readIdempotencyKey(request: AdminRequest): string {
  const header = request.headers?.['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException('Enter an idempotency key');
  }
  return value.trim();
}


