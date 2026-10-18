import { Controller, Get, Header, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { CustomerAccessGuard } from '../auth/customer-access.guard.js';
import { PlacesService, readSearchBias } from './places.service.js';

@Controller('customers/me/places')
@UseGuards(CustomerAccessGuard)
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get()
  search(
    @Query('text') text: unknown,
    @Query('latitude') latitude: unknown,
    @Query('longitude') longitude: unknown,
  ) {
    return this.places.search(typeof text === 'string' ? text : '', readSearchBias(latitude, longitude));
  }

  @Get('map')
  @Header('Cache-Control', 'private, max-age=86400')
  async map(@Query('latitude') latitude: unknown, @Query('longitude') longitude: unknown) {
    const bytes = await this.places.pointMap(readNumber(latitude), readNumber(longitude));
    return new StreamableFile(Buffer.from(bytes), { type: 'image/png', disposition: 'inline' });
  }
}

function readNumber(value: unknown): number {
  return typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
}
