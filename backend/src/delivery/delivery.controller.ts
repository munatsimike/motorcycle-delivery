import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Logger,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { CustomerAccessGuard, type CustomerRequest } from '../auth/customer-access.guard.js';
import { DeliveryService } from './delivery.service.js';
import { DispatchService } from './dispatch.service.js';
import { PlacesService } from './places.service.js';

@Controller('customers/me/deliveries')
@UseGuards(CustomerAccessGuard)
export class DeliveryController {
  private readonly logger = new Logger(DeliveryController.name);

  constructor(
    private readonly deliveries: DeliveryService,
    private readonly dispatch: DispatchService,
    private readonly places: PlacesService,
  ) {}

  @Post('quote')
  @HttpCode(200)
  quote(@Req() request: CustomerRequest, @Body() body: unknown) {
    requiredCustomer(request);
    return this.deliveries.quote(body);
  }

  @Post()
  async create(@Req() request: CustomerRequest, @Body() body: unknown) {
    const customer = requiredCustomer(request);
    const created = await this.deliveries.create(customer, body);
    let started: { status: string; searchGeneration: number };
    try {
      started = await this.dispatch.search(customer, created.id);
    } catch (error) {
      this.logger.error(`Automatic search failed deliveryId=${created.id} error=${errorName(error)}`);
      return created;
    }
    try {
      return await this.deliveries.getById(customer, created.id);
    } catch (error) {
      this.logger.error(`Automatic search reload failed deliveryId=${created.id} error=${errorName(error)}`);
      return {
        ...created,
        status: started.status,
        searchGeneration: started.searchGeneration,
        autoRetryCount: 0,
        nextRetryAt: null,
      };
    }
  }

  @Get()
  list(@Req() request: CustomerRequest, @Query() query: Record<string, unknown>) {
    return this.deliveries.list(requiredCustomer(request), query);
  }

  @Get(':deliveryId/map')
  @Header('Cache-Control', 'private, max-age=86400')
  async map(@Req() request: CustomerRequest, @Param('deliveryId') deliveryId: string) {
    const delivery = await this.deliveries.getById(requiredCustomer(request), deliveryId);
    const bytes = await this.places.deliveryMap(
      Number(delivery.pickup.latitude),
      Number(delivery.pickup.longitude),
      Number(delivery.dropoff.latitude),
      Number(delivery.dropoff.longitude),
    );
    return new StreamableFile(Buffer.from(bytes), { type: 'image/png', disposition: 'inline' });
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

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}


