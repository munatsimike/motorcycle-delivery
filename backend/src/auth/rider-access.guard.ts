import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { RiderAccessService, type RiderContext } from './rider-access.service.js';

export type RiderRequest = {
  headers?: { authorization?: string | string[] };
  rider?: RiderContext;
};

@Injectable()
export class RiderAccessGuard implements CanActivate {
  constructor(private readonly access: RiderAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RiderRequest>();
    const header = request.headers?.authorization;
    request.rider = await this.access.authenticate(typeof header === 'string' ? header : undefined);
    return true;
  }
}
