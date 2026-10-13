import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import { MotorcycleService } from './motorcycle.service.js';

@Controller('riders/me/motorcycles')
@UseGuards(RiderAccessGuard)
export class MotorcycleController {
  constructor(private readonly motorcycles: MotorcycleService) {}

  @Post()
  @HttpCode(201)
  register(@Req() request: RiderRequest, @Body() body: unknown) {
    return this.motorcycles.register(requiredRider(request), body);
  }

  @Get()
  list(@Req() request: RiderRequest) {
    return this.motorcycles.list(requiredRider(request));
  }

  @Get(':id')
  get(@Req() request: RiderRequest, @Param('id') motorcycleId: string) {
    return this.motorcycles.get(requiredRider(request), motorcycleId);
  }

  @Patch(':id')
  update(@Req() request: RiderRequest, @Param('id') motorcycleId: string, @Body() body: unknown) {
    return this.motorcycles.update(requiredRider(request), motorcycleId, body);
  }

  @Put(':id/active')
  selectActive(@Req() request: RiderRequest, @Param('id') motorcycleId: string) {
    return this.motorcycles.selectActive(requiredRider(request), motorcycleId);
  }

  @Delete(':id/active')
  clearActive(@Req() request: RiderRequest, @Param('id') motorcycleId: string) {
    return this.motorcycles.clearActive(requiredRider(request), motorcycleId);
  }

  @Delete(':id')
  @HttpCode(204)
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
