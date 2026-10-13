import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import { INCOMING_IMAGE_MAX_BYTES } from './licence.constants.js';
import { LicenceImageService } from './licence-image.service.js';
import { LicenceUploadExceptionFilter } from './licence-upload.filter.js';

type UploadedImage = { buffer?: Buffer };

@Controller('riders/me')
@UseGuards(RiderAccessGuard)
@UseFilters(LicenceUploadExceptionFilter)
export class LicenceImageController {
  constructor(private readonly licences: LicenceImageService) {}

  @Post('licence-image')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: INCOMING_IMAGE_MAX_BYTES } }))
  upload(@Req() request: RiderRequest, @UploadedFile() file?: UploadedImage) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    if (!file?.buffer) {
      throw new BadRequestException('Choose a licence image');
    }
    return this.licences.upload(request.rider, file.buffer);
  }

  @Get('licence-image')
  current(@Req() request: RiderRequest) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    return this.licences.current(request.rider);
  }
}
