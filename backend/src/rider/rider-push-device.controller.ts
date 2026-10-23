import { Body, Controller, Delete, ForbiddenException, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RiderAccessGuard, type RiderRequest } from '../auth/rider-access.guard.js';
import { PushDeviceBody, PushDeviceResponse } from '../openapi/schemas.js';
import { RiderPushDeviceService } from './rider-push-device.service.js';

@ApiTags('Rider push devices')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Rider access is required' })
@Controller('riders/me/push-devices')
@UseGuards(RiderAccessGuard)
export class RiderPushDeviceController {
  constructor(private readonly devices: RiderPushDeviceService) {}

  @Put()
  @HttpCode(200)
  @ApiOperation({ summary: 'Register this device for delivery request alerts' })
  @ApiOkResponse({ type: PushDeviceResponse })
  register(@Req() request: RiderRequest, @Body() body: PushDeviceBody) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    return this.devices.register(request.rider, body?.fcmToken);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove this device from delivery request alerts' })
  @ApiNoContentResponse()
  async remove(@Req() request: RiderRequest, @Body() body: PushDeviceBody) {
    if (!request.rider) {
      throw new ForbiddenException('Rider access is required');
    }
    await this.devices.remove(request.rider, body?.fcmToken);
  }
}
