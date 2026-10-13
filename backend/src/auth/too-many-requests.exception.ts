import { HttpException, HttpStatus } from '@nestjs/common';

export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too many verification attempts. Try again later.') {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
