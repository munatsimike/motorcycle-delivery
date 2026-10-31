import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CustomerAccessGuard, type CustomerRequest } from '../auth/customer-access.guard.js';
import { INCOMING_IMAGE_MAX_BYTES } from './licence.constants.js';
import { CustomerAccountProfilePhotoService } from './customer-account-profile-photo.service.js';
import { ProfilePhotoUploadExceptionFilter } from './profile-photo.filter.js';

type UploadedImage = { buffer?: Buffer };

@ApiTags('Customer account')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Customer access is required' })
@Controller('customers/me')
@UseGuards(CustomerAccessGuard)
@UseFilters(ProfilePhotoUploadExceptionFilter)
export class CustomerAccountProfilePhotoController {
  constructor(private readonly photos: CustomerAccountProfilePhotoService) {}

  @Post('profile-photo')
  @HttpCode(201)
  @ApiOperation({ summary: 'Upload or replace the customer profile photo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary', description: 'Profile photo file.' } },
    },
  })
  @ApiCreatedResponse({ description: 'The stored profile photo record. The object key is not included.' })
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: INCOMING_IMAGE_MAX_BYTES } }))
  upload(@Req() request: CustomerRequest, @UploadedFile() file?: UploadedImage) {
    if (!request.customer) {
      throw new ForbiddenException('Customer access is required');
    }
    if (!file?.buffer) {
      throw new BadRequestException('Choose a profile photo');
    }
    return this.photos.upload(request.customer, file.buffer);
  }

  @Get('profile-photo')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Download the current customer profile photo' })
  @ApiOkResponse({ description: 'The private profile photo.', content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } })
  async image(@Req() request: CustomerRequest) {
    if (!request.customer) {
      throw new ForbiddenException('Customer access is required');
    }
    const image = await this.photos.image(request.customer);
    return new StreamableFile(image.bytes, {
      type: image.contentType,
      disposition: 'inline',
    });
  }

  @Delete('profile-photo')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the current customer profile photo' })
  @ApiNoContentResponse({ description: 'The profile photo is no longer visible. Repeating this request also succeeds.' })
  async remove(@Req() request: CustomerRequest) {
    if (!request.customer) {
      throw new ForbiddenException('Customer access is required');
    }
    await this.photos.remove(request.customer);
  }
}
