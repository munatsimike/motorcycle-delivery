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
  ) {
    return this.places.search(typeof text === 'string' ? text : '', readSearchBias(latitude, longitude));
  }
}
