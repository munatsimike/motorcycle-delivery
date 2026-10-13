import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { CustomerAccessService, type CustomerContext, type CustomerSession } from './customer-access.service.js';

export type CustomerSessionRequest = {
  headers?: { authorization?: string | string[] };
  customerSession?: CustomerSession;
};

export type CustomerRequest = {
  headers?: { authorization?: string | string[] };
  customer?: CustomerContext;
};

@Injectable()
export class CustomerSessionGuard implements CanActivate {
  constructor(private readonly access: CustomerAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerSessionRequest>();
    const header = request.headers?.authorization;
    request.customerSession = await this.access.authenticate(typeof header === 'string' ? header : undefined);
    return true;
  }
}

@Injectable()
export class CustomerAccessGuard implements CanActivate {
  constructor(private readonly access: CustomerAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const header = request.headers?.authorization;
    request.customer = await this.access.authenticateAccount(typeof header === 'string' ? header : undefined);
    return true;
  }
}
