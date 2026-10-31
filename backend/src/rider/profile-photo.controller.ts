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
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import { INCOMING_IMAGE_MAX_BYTES } from './licence.constants.js';
import { ProfilePhotoUploadExceptionFilter } from './profile-photo.filter.js';
import { ProfilePhotoService } from './profile-photo.service.js';

type UploadedImage = { buffer?: Buffer };

@ApiTags('Rider profile')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me')
@UseGuards(RiderAccessGuard)
@UseFilters(ProfilePhotoUploadExceptionFilter)
export class ProfilePhotoController {
  constructor(private readonly photos: ProfilePhotoService) {}

  @Post('profile-photo')
  @HttpCode(201)
  @ApiOperation({ summary: 'Upload or replace the rider profile photo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary', description: 'Profile photo file.' } },
    },
  })
  @ApiCreatedResponse({ description: 'The stored profile photo record.' })
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: INCOMING_IMAGE_MAX_BYTES } }))
  upload(@Req() request: RiderRequest, @UploadedFile() file?: UploadedImage) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    if (!file?.buffer) {
      throw new BadRequestException('Choose a profile photo');
    }
    return this.photos.upload(request.rider, file.buffer);
  }

  @Get('profile-photo')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Download the current profile photo' })
  @ApiOkResponse({ description: 'The private profile photo.', content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } })
  async image(@Req() request: RiderRequest) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    const image = await this.photos.image(request.rider);
    return new StreamableFile(image.bytes, {
      type: image.contentType,
      disposition: 'inline',
    });
  }

  @Delete('profile-photo')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the current profile photo' })
  @ApiNoContentResponse({ description: 'The profile photo is no longer visible. Repeating this request also succeeds.' })
  async remove(@Req() request: RiderRequest) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    await this.photos.remove(request.rider);
  }
}
