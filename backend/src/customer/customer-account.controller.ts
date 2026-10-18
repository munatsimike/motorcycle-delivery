import { Body, Controller, ForbiddenException, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { CustomerAccessGuard, CustomerSessionGuard, type CustomerRequest, type CustomerSessionRequest } from '../auth/customer-access.guard.js';
import { CustomerAccountService } from './customer-account.service.js';

@Controller('customers/me')
export class CustomerAccountController {
  constructor(private readonly accounts: CustomerAccountService) {}

  @Post()
  @HttpCode(200)
  @UseGuards(CustomerSessionGuard)
  activate(@Req() request: CustomerSessionRequest, @Body() body: unknown) {
    if (!request.customerSession) {
      throw new ForbiddenException('Customer access is required');
    }
    return this.accounts.activate(request.customerSession, body);
  }

  @Patch()
  @UseGuards(CustomerAccessGuard)
  update(@Req() request: CustomerRequest, @Body() body: unknown) {
    if (!request.customer) {
      throw new ForbiddenException('Customer access is required');
    }
    return this.accounts.update(request.customer, body);
  }

  @Get()
  @UseGuards(CustomerAccessGuard)
  current(@Req() request: CustomerRequest) {
    if (!request.customer) {
      throw new ForbiddenException('Customer access is required');
    }
    return this.accounts.current(request.customer);
  }
}
