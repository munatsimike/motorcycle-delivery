import { Controller, ForbiddenException, Get, Header, Param, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CustomerAccessGuard, type CustomerRequest } from '../auth/customer-access.guard.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import { CustomerProfilePhotoService } from './customer-profile-photo.service.js';

@ApiTags('Customer deliveries')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Customer access is required' })
@Controller('customers/me/deliveries')
@UseGuards(CustomerAccessGuard)
export class CustomerProfilePhotoController {
  constructor(private readonly photos: CustomerProfilePhotoService) {}

  @Get(':deliveryId/bids/:bidId/profile-photo')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Download the profile photo of a rider who has an open bid' })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiParam({ name: 'bidId', format: 'uuid' })
  @ApiOkResponse({ description: 'The private profile photo.', content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } })
  @ApiNotFoundResponse({ description: 'Delivery or profile photo not found' })
  async bidImage(
    @Req() request: CustomerRequest,
    @Param('deliveryId') deliveryId: string,
    @Param('bidId') bidId: string,
  ) {
    return file(await this.photos.bidImage(requiredCustomer(request), deliveryId, bidId));
  }

  @Get(':deliveryId/rider-profile-photo')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Download the assigned rider profile photo' })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiOkResponse({ description: 'The private profile photo.', content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } })
  @ApiNotFoundResponse({ description: 'Delivery or profile photo not found' })
  async assignedImage(@Req() request: CustomerRequest, @Param('deliveryId') deliveryId: string) {
    return file(await this.photos.assignedImage(requiredCustomer(request), deliveryId));
  }
}

function requiredCustomer(request: CustomerRequest): CustomerContext {
  if (!request.customer) {
    throw new ForbiddenException('Customer access is required');
  }
  return request.customer;
}

function file(image: { bytes: Buffer; contentType: string }): StreamableFile {
  return new StreamableFile(image.bytes, { type: image.contentType, disposition: 'inline' });
}
