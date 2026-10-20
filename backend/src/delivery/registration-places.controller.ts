import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RegistrationProofGuard } from '../auth/registration-proof.guard.js';
import { PlacesService, readSearchBias } from './places.service.js';

@ApiTags('Customer authentication')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'The registration proof is missing or no longer valid.' })
@Controller('auth/customer/places')
@UseGuards(RegistrationProofGuard)
export class RegistrationPlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get()
  @ApiOperation({ summary: 'Search places while completing customer registration' })
  @ApiQuery({ name: 'text', required: true, schema: { type: 'string' } })
  @ApiQuery({ name: 'latitude', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'longitude', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'sessionToken', required: false, schema: { type: 'string' } })
  @ApiOkResponse({ description: 'Place predictions. Authorize with the registration proof, not a session access token.' })
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
  @ApiOperation({ summary: 'Read one place while completing customer registration' })
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
}
