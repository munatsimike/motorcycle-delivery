import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CustomerAccessGuard, type CustomerRequest } from '../auth/customer-access.guard.js';
import { CreateDeliveryBody, QuoteBody, QuoteResponse } from '../openapi/schemas.js';
import { DeliveryService } from './delivery.service.js';
import { DispatchService } from './dispatch.service.js';
import { PlacesService } from './places.service.js';

@ApiTags('Customer deliveries')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Customer access is required' })
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
  @ApiOperation({ summary: 'Quote a parcel delivery from pickup and drop-off coordinates' })
  @ApiBody({ type: QuoteBody })
  @ApiOkResponse({ type: QuoteResponse })
  @ApiConflictResponse({ description: 'Delivery pricing is not configured' })
  quote(@Req() request: CustomerRequest, @Body() body: unknown) {
    requiredCustomer(request);
    return this.deliveries.quote(body);
  }

  @Post()
  @ApiOperation({ summary: 'Create a parcel delivery and start rider search' })
  @ApiBody({ type: CreateDeliveryBody })
  @ApiCreatedResponse({ description: 'The created delivery. Search starts automatically when dispatch accepts it.' })
  @ApiConflictResponse({ description: 'Delivery pricing is not configured' })
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
  @ApiOperation({ summary: 'List the signed-in customer deliveries' })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiQuery({ name: 'status', required: false, description: 'One delivery status. Repeat the parameter to filter by more than one.', schema: { type: 'string' } })
  @ApiOkResponse({ description: 'A page of delivery summaries.' })
  list(@Req() request: CustomerRequest, @Query() query: Record<string, unknown>) {
    return this.deliveries.list(requiredCustomer(request), query);
  }

  @Get(':deliveryId/map')
  @Header('Cache-Control', 'private, max-age=86400')
  @ApiOperation({ summary: 'Download the delivery route preview' })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiOkResponse({ description: 'PNG map image.', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } })
  @ApiNotFoundResponse({ description: 'The map preview is unavailable.' })
  async map(@Req() request: CustomerRequest, @Param('deliveryId') deliveryId: string) {
    const delivery = await this.deliveries.getById(requiredCustomer(request), deliveryId);
    const pickupLatitude = finiteCoordinate(delivery.pickup.latitude);
    const pickupLongitude = finiteCoordinate(delivery.pickup.longitude);
    const dropoffLatitude = finiteCoordinate(delivery.dropoff.latitude);
    const dropoffLongitude = finiteCoordinate(delivery.dropoff.longitude);
    if (pickupLatitude === null || pickupLongitude === null || dropoffLatitude === null || dropoffLongitude === null) {
      throw new NotFoundException('The map preview is unavailable.');
    }
    const bytes = await this.places.deliveryMap(
      pickupLatitude,
      pickupLongitude,
      dropoffLatitude,
      dropoffLongitude,
    );
    return new StreamableFile(Buffer.from(bytes), { type: 'image/png', disposition: 'inline' });
  }

  @Get(':deliveryId')
  @ApiOperation({ summary: 'Read one customer delivery' })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiOkResponse({ description: 'The delivery, including pickup, drop-off, and current status.' })
  @ApiNotFoundResponse({ description: 'Delivery not found' })
  getById(@Req() request: CustomerRequest, @Param('deliveryId') deliveryId: string) {
    return this.deliveries.getById(requiredCustomer(request), deliveryId);
  }
  @Post(':deliveryId/search')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start or restart rider search for a delivery' })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiOkResponse({ description: 'Search was accepted for this delivery.' })
  search(@Req() request: CustomerRequest, @Param('deliveryId') deliveryId: string) {
    return this.dispatch.search(requiredCustomer(request), deliveryId);
  }

  @Post(':deliveryId/cancellation')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a delivery that is still waiting for a rider' })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiOkResponse({ description: 'The delivery status is CANCELLED.' })
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

function finiteCoordinate(value: string | null): number | null {
  if (value == null || !value.trim()) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}


