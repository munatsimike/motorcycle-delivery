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
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import { INCOMING_IMAGE_MAX_BYTES } from './licence.constants.js';
import { LicenceImageService } from './licence-image.service.js';
import { LicenceUploadExceptionFilter } from './licence-upload.filter.js';

type UploadedImage = { buffer?: Buffer };

@ApiTags('Rider licence')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me')
@UseGuards(RiderAccessGuard)
@UseFilters(LicenceUploadExceptionFilter)
export class LicenceImageController {
  constructor(private readonly licences: LicenceImageService) {}

  @Post('licence-image')
  @HttpCode(201)
  @ApiOperation({ summary: 'Upload a licence image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary', description: 'Licence image file.' } },
    },
  })
  @ApiCreatedResponse({ description: 'The stored licence image record.' })
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
  @ApiOperation({ summary: 'Read the current licence image record' })
  @ApiOkResponse({ description: 'The rider current stored licence image.' })
  current(@Req() request: RiderRequest) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    return this.licences.current(request.rider);
  }
}
