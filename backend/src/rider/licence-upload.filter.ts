import { Catch, type ArgumentsHost, PayloadTooLargeException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

export function licenceUploadException(exception: unknown): unknown {
  if (isIncomingFileTooLarge(exception)) {
    return new PayloadTooLargeException('Licence image is too large');
  }
  return exception;
}

export function isIncomingFileTooLarge(exception: unknown): boolean {
  return typeof exception === 'object'
    && exception !== null
    && 'code' in exception
    && exception.code === 'LIMIT_FILE_SIZE';
}

@Catch()
export class LicenceUploadExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(licenceUploadException(exception), host);
  }
}
