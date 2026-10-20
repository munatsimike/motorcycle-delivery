import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import { MotorcycleBody } from '../openapi/schemas.js';
import { MotorcycleService } from './motorcycle.service.js';

@ApiTags('Rider motorcycles')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me/motorcycles')
@UseGuards(RiderAccessGuard)
export class MotorcycleController {
  constructor(private readonly motorcycles: MotorcycleService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a motorcycle' })
  @ApiBody({ type: MotorcycleBody })
  @ApiCreatedResponse({ description: 'The created motorcycle. Verification starts as pending.' })
  register(@Req() request: RiderRequest, @Body() body: unknown) {
    return this.motorcycles.register(requiredRider(request), body);
  }

  @Get()
  @ApiOperation({ summary: 'List the rider motorcycles' })
  @ApiOkResponse({ description: 'Motorcycles registered by the signed-in rider.' })
  list(@Req() request: RiderRequest) {
    return this.motorcycles.list(requiredRider(request));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one motorcycle' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'The motorcycle owned by the signed-in rider.' })
  get(@Req() request: RiderRequest, @Param('id') motorcycleId: string) {
    return this.motorcycles.get(requiredRider(request), motorcycleId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update motorcycle identity details' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: MotorcycleBody })
  @ApiOkResponse({ description: 'The updated motorcycle.' })
  update(@Req() request: RiderRequest, @Param('id') motorcycleId: string, @Body() body: unknown) {
    return this.motorcycles.update(requiredRider(request), motorcycleId, body);
  }

  @Put(':id/active')
  @ApiOperation({ summary: 'Select the active verified motorcycle' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'The motorcycle is now the active one.' })
  selectActive(@Req() request: RiderRequest, @Param('id') motorcycleId: string) {
    return this.motorcycles.selectActive(requiredRider(request), motorcycleId);
  }

  @Delete(':id/active')
  @ApiOperation({ summary: 'Clear the active motorcycle selection' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'The motorcycle is no longer active.' })
  clearActive(@Req() request: RiderRequest, @Param('id') motorcycleId: string) {
    return this.motorcycles.clearActive(requiredRider(request), motorcycleId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a motorcycle' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'The motorcycle was removed.' })
  remove(@Req() request: RiderRequest, @Param('id') motorcycleId: string) {
    return this.motorcycles.remove(requiredRider(request), motorcycleId);
  }
}

function requiredRider(request: RiderRequest) {
  if (!request.rider) {
    throw new ForbiddenException('Rider access is required');
  }
  return request.rider;
}
