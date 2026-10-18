import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { readBearerToken } from './access-token.service.js';
import { readRegistrationProof } from './registration-proof.js';

@Injectable()
export class RegistrationProofGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers?: { authorization?: string | string[] } }>();
    const header = request.headers?.authorization;
    readRegistrationProof(readBearerToken(typeof header === 'string' ? header : undefined));
    return true;
  }
}
