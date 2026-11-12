import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiForbiddenResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import type { RiderContext } from '../auth/rider-access.service.js';
import { DispatchService } from './dispatch.service.js';
import { encodePolyline } from './geoapify.js';
import { PICKUP_APPROACH, type PickupApproachLookup } from './pickup-approach.js';
import { PlacesService } from './places.service.js';

type AssignmentRequest = RiderRequest & {
  headers?: RiderRequest['headers'] & { 'idempotency-key'?: string | string[] };
};

const COLLECTION_STATUSES = new Set(['RIDER_ASSIGNED', 'ASSIGNED', 'COLLECTING', 'ARRIVED_AT_PICKUP']);
const DELIVERY_ROUTE_STATUSES = new Set(['COLLECTED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'IN_TRANSIT', 'ARRIVED_AT_DROPOFF']);

@ApiTags('Rider deliveries')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me/assignments')
@UseGuards(RiderAccessGuard)
export class RiderAssignmentController {
  constructor(
    private readonly dispatch: DispatchService,
    @Optional() @Inject(PICKUP_APPROACH) private readonly routes: PickupApproachLookup | null = null,
    // `PlacesService | null` emits as Object, so Nest will not inject it unless the token is explicit.
    @Optional() @Inject(PlacesService) private readonly places: PlacesService | null = null,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Read the rider live accepted assignments' })
  @ApiOkResponse({ description: 'Every accepted delivery still in progress for this rider, oldest first.' })
  list(@Req() request: RiderRequest) {
    return this.dispatch.liveAssignments(requiredRider(request));
  }

  @Get('completed')
  @ApiOperation({ summary: 'Read deliveries this rider has completed' })
  @ApiOkResponse({ description: 'Delivered marketplace and V1 assignments for this rider, newest first.' })
  completed(@Req() request: RiderRequest) {
    return this.dispatch.completedAssignments(requiredRider(request));
  }

  @Get('active')
  @ApiOperation({ summary: 'Read the rider active assignment' })
  @ApiOkResponse({ description: 'The accepted delivery, or assignment null when the rider has none.' })
  active(@Req() request: RiderRequest) {
    return this.dispatch.activeAssignment(requiredRider(request));
  }

  @Get(':assignmentId/pickup-route')
  @ApiOperation({ summary: 'Read the driving route from the rider to this assignment pickup' })
  @ApiParam({ name: 'assignmentId', format: 'uuid' })
  @ApiOkResponse({ description: 'Encoded road geometry from the rider fix to the stored pickup. An empty line means no route is available.' })
  async pickupRoute(
    @Req() request: RiderRequest,
    @Param('assignmentId') assignmentId: string,
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
  ) {
    const rider = requiredRider(request);
    const riderLatitude = finiteCoordinate(latitude, 90);
    const riderLongitude = finiteCoordinate(longitude, 180);
    if (riderLatitude === null || riderLongitude === null) {
      throw new BadRequestException('Enter a valid location');
    }
    const { assignments } = await this.dispatch.liveAssignments(rider);
    const match = assignments.find((item) => item.assignmentId === assignmentId);
    if (!match) {
      throw new NotFoundException('Delivery not found');
    }
    if (!COLLECTION_STATUSES.has(match.status) || !this.routes) {
      return { geometry: '', line: [] };
    }
    const pickupLatitude = finiteCoordinate(match.pickup.latitude, 90);
    const pickupLongitude = finiteCoordinate(match.pickup.longitude, 180);
    if (pickupLatitude === null || pickupLongitude === null) {
      return { geometry: '', line: [] };
    }
    const approach = await this.routes.lookup({
      riderProfileId: rider.riderProfileId,
      riderLatitude,
      riderLongitude,
      pickupLatitude,
      pickupLongitude,
    }).catch(() => null);
    const line = approach?.line ?? [];
    const drawn = line.length > 1;
    return {
      geometry: drawn ? encodePolyline(line.map((point) => [point.longitude, point.latitude])) : '',
      line,
      ...(approach && drawn ? {
        metres: approach.metres,
        seconds: approach.seconds,
        path: approach.path && approach.path.length > 1 ? approach.path : line,
        steps: approach.steps ?? [],
      } : {}),
    };
  }

  @Get(':assignmentId/delivery-route')
  @ApiOperation({ summary: 'Read the driving route from this assignment pickup to its drop-off' })
  @ApiParam({ name: 'assignmentId', format: 'uuid' })
  @ApiOkResponse({ description: 'Road geometry between the stored pickup and drop-off. After collection, latitude and longitude switch the origin to the rider. guidance=1 uses the rider as the origin for every drop-off status. path and steps are added when a road is drawn. An empty line means no route is available.' })
  async deliveryRoute(
    @Req() request: RiderRequest,
    @Param('assignmentId') assignmentId: string,
    @Query('latitude') latitude?: string,
    @Query('longitude') longitude?: string,
    @Query('guidance') guidance?: string,
  ) {
    const rider = requiredRider(request);
    const { assignments } = await this.dispatch.liveAssignments(rider);
    const match = assignments.find((item) => item.assignmentId === assignmentId);
    if (!match || !DELIVERY_ROUTE_STATUSES.has(match.status)) {
      return { geometry: '', line: [] };
    }
    const pickupLatitude = finiteCoordinate(match.pickup.latitude, 90);
    const pickupLongitude = finiteCoordinate(match.pickup.longitude, 180);
    const dropoffLatitude = finiteCoordinate(match.dropoff.latitude, 90);
    const dropoffLongitude = finiteCoordinate(match.dropoff.longitude, 180);
    if (pickupLatitude === null || pickupLongitude === null || dropoffLatitude === null || dropoffLongitude === null) {
      return { geometry: '', line: [] };
    }
    if (!this.places) {
      return { geometry: '', line: [] };
    }
    const riderLatitude = finiteCoordinate(latitude, 90);
    const riderLongitude = finiteCoordinate(longitude, 180);
    const guiding = guidance === '1' || guidance === 'true';
    const fromRider = riderLatitude !== null
      && riderLongitude !== null
      && (guiding || match.status === 'COLLECTED' || match.status === 'PICKED_UP');
    const route = await this.places.deliveryRoute(
      fromRider && riderLatitude !== null ? riderLatitude : pickupLatitude,
      fromRider && riderLongitude !== null ? riderLongitude : pickupLongitude,
      dropoffLatitude,
      dropoffLongitude,
    );
    const line = route.line;
    const drawn = line.length > 1;
    const path = drawn && Array.isArray(route.path) && route.path.length > 1 ? route.path : line;
    const steps = drawn && Array.isArray(route.steps) ? route.steps : [];
    return {
      geometry: drawn ? encodePolyline(line.map((point) => [point.longitude, point.latitude])) : '',
      line,
      ...(drawn ? {
        path,
        steps,
        ...(typeof route.metres === 'number' ? { metres: route.metres } : {}),
        ...(typeof route.seconds === 'number' ? { seconds: Math.round(route.seconds) } : {}),
      } : {}),
    };
  }

  @Post(':assignmentId/cancellation')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an assigned V2 delivery before pickup and reopen the original request' })
  @ApiParam({ name: 'assignmentId', format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' }, note: { type: 'string' } } } })
  @ApiOkResponse({ description: 'The assignment ended. The original delivery reopens when the deadline remains.' })
  cancel(@Req() request: AssignmentRequest, @Param('assignmentId') assignmentId: string, @Body() body: unknown) {
    return this.dispatch.cancelBeforePickup(requiredRider(request), assignmentId, readIdempotencyKey(request), body);
  }
}

function readIdempotencyKey(request: AssignmentRequest): string {
  const header = request.headers?.['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException('Enter an idempotency key');
  }
  return value.trim();
}

function finiteCoordinate(value: string | null | undefined, limit: number): number | null {
  if (value == null || !value.trim()) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) {
    return null;
  }
  return parsed;
}

function requiredRider(request: RiderRequest): RiderContext {
  if (!request.rider) {
    throw new ForbiddenException('Rider access is required');
  }
  return request.rider;
}
