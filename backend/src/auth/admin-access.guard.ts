import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AdminAccessService, type AdminContext } from './admin-access.service.js';

export type AdminRequest = {
  headers?: { authorization?: string | string[] };
  admin?: AdminContext;
};

@Injectable()
export class AdminAccessGuard implements CanActivate {
  constructor(private readonly access: AdminAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const header = request.headers?.authorization;
    request.admin = await this.access.authenticate(typeof header === 'string' ? header : undefined);
    return true;
  }
}
