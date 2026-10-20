import { Controller, Get, Header, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CustomerAccessGuard } from '../auth/customer-access.guard.js';
import { PlacesService, readSearchBias } from './places.service.js';

@ApiTags('Customer places')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Customer access is required' })
@Controller('customers/me/places')
@UseGuards(CustomerAccessGuard)
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get()
  @ApiOperation({ summary: 'Search places for a delivery stop' })
  @ApiQuery({ name: 'text', required: true, schema: { type: 'string' } })
  @ApiQuery({ name: 'latitude', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'longitude', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'sessionToken', required: false, schema: { type: 'string' } })
  @ApiOkResponse({ description: 'Place predictions for the search text.' })
  search(
    @Query('text') text: unknown,
    @Query('latitude') latitude: unknown,
    @Query('longitude') longitude: unknown,
    @Query('sessionToken') sessionToken: unknown,
  ) {
    return this.places.search(
      typeof text === 'string' ? text : '',
      readSearchBias(latitude, longitude),
      typeof sessionToken === 'string' ? sessionToken : '',
    );
  }

  @Get('detail')
  @ApiOperation({ summary: 'Read one place selected from search' })
  @ApiQuery({ name: 'placeId', required: true, schema: { type: 'string' } })
  @ApiQuery({ name: 'sessionToken', required: false, schema: { type: 'string' } })
  @ApiOkResponse({ description: 'The place address and coordinates.' })
  detail(
    @Query('placeId') placeId: unknown,
    @Query('sessionToken') sessionToken: unknown,
  ) {
    return this.places.place(
      typeof placeId === 'string' ? placeId : '',
      typeof sessionToken === 'string' ? sessionToken : '',
    );
  }

  @Get('map')
  @Header('Cache-Control', 'private, max-age=86400')
  @ApiOperation({ summary: 'Download a map preview for one coordinate' })
  @ApiQuery({ name: 'latitude', required: true, schema: { type: 'string' } })
  @ApiQuery({ name: 'longitude', required: true, schema: { type: 'string' } })
  @ApiOkResponse({ description: 'PNG map image.', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } })
  async map(@Query('latitude') latitude: unknown, @Query('longitude') longitude: unknown) {
    const bytes = await this.places.pointMap(readNumber(latitude), readNumber(longitude));
    return new StreamableFile(Buffer.from(bytes), { type: 'image/png', disposition: 'inline' });
  }
}

function readNumber(value: unknown): number {
  return typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
}
