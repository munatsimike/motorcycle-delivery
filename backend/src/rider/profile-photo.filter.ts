import { Catch, PayloadTooLargeException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { isIncomingFileTooLarge } from './licence-upload.filter.js';

export function profilePhotoUploadException(exception: unknown): unknown {
  if (isIncomingFileTooLarge(exception)) {
    return new PayloadTooLargeException('Profile photo is too large');
  }
  return exception;
}

@Catch()
export class ProfilePhotoUploadExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(profilePhotoUploadException(exception), host);
  }
}
