import { Body, Controller, Delete, ForbiddenException, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CustomerAccessGuard, type CustomerRequest } from '../auth/customer-access.guard.js';
import { PushDeviceBody, PushDeviceResponse } from '../openapi/schemas.js';
import { CustomerFcmDeviceService } from './customer-fcm-device.service.js';

@ApiTags('Customer push devices')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Customer access is required' })
@ApiNotFoundResponse({ description: 'Bidding is not available' })
@Controller('customers/me/push-devices')
@UseGuards(CustomerAccessGuard)
export class CustomerFcmDeviceController {
  constructor(private readonly devices: CustomerFcmDeviceService) {}

  @Put()
  @HttpCode(200)
  @ApiOperation({ summary: 'Register this device for delivery status alerts' })
  @ApiOkResponse({ type: PushDeviceResponse })
  register(@Req() request: CustomerRequest, @Body() body: PushDeviceBody) {
    if (!request.customer) {
      throw new ForbiddenException('Customer access is required');
    }
    return this.devices.register(request.customer, body?.fcmToken);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove this device from delivery status alerts' })
  @ApiNoContentResponse()
  async remove(@Req() request: CustomerRequest, @Body() body: PushDeviceBody) {
    if (!request.customer) {
      throw new ForbiddenException('Customer access is required');
    }
    await this.devices.remove(request.customer, body?.fcmToken);
  }
}
