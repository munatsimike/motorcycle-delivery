import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RegistrationProofGuard } from '../auth/registration-proof.guard.js';
import { PlacesService, readSearchBias } from './places.service.js';

@Controller('auth/customer/places')
@UseGuards(RegistrationProofGuard)
export class RegistrationPlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get()
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
  detail(
    @Query('placeId') placeId: unknown,
    @Query('sessionToken') sessionToken: unknown,
  ) {
    return this.places.place(
      typeof placeId === 'string' ? placeId : '',
      typeof sessionToken === 'string' ? sessionToken : '',
    );
  }
}
