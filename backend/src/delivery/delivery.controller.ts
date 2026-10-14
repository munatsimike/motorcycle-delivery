import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CustomerAccessGuard, type CustomerRequest } from '../auth/customer-access.guard.js';
import { DeliveryService } from './delivery.service.js';
import { DispatchService } from './dispatch.service.js';

@Controller('customers/me/deliveries')
@UseGuards(CustomerAccessGuard)
export class DeliveryController {
  constructor(
    private readonly deliveries: DeliveryService,
    private readonly dispatch: DispatchService,
  ) {}

  @Post('quote')
  @HttpCode(200)
  quote(@Req() request: CustomerRequest, @Body() body: unknown) {
    requiredCustomer(request);
    return this.deliveries.quote(body);
  }

  @Post()
  create(@Req() request: CustomerRequest, @Body() body: unknown) {
    return this.deliveries.create(requiredCustomer(request), body);
  }

  @Get(':deliveryId')
  getById(@Req() request: CustomerRequest, @Param('deliveryId') deliveryId: string) {
    return this.deliveries.getById(requiredCustomer(request), deliveryId);
  }
  @Post(':deliveryId/search')
  @HttpCode(200)
  search(@Req() request: CustomerRequest, @Param('deliveryId') deliveryId: string) {
    return this.dispatch.search(requiredCustomer(request), deliveryId);
  }

  @Post(':deliveryId/cancellation')
  @HttpCode(200)
  cancel(@Req() request: CustomerRequest, @Param('deliveryId') deliveryId: string) {
    return this.dispatch.cancel(requiredCustomer(request), deliveryId);
  }
}

function requiredCustomer(request: CustomerRequest) {
  if (!request.customer) {
    throw new ForbiddenException('Customer access is required');
  }
  return request.customer;
}


