import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CustomerAccessGuard, type CustomerRequest } from '../auth/customer-access.guard.js';
import { CustomerSavedAddressService } from './customer-saved-address.service.js';

@ApiTags('Customer addresses')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Customer access is required' })
@Controller('customers/me/addresses')
@UseGuards(CustomerAccessGuard)
export class CustomerSavedAddressController {
  constructor(private readonly addresses: CustomerSavedAddressService) {}

  @Get()
  @ApiOperation({ summary: 'List the signed-in customer saved addresses' })
  @ApiOkResponse({ description: 'Saved addresses for this customer' })
  list(@Req() request: CustomerRequest) {
    return this.addresses.list(requiredCustomer(request));
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Save an address for the signed-in customer' })
  @ApiOkResponse({ description: 'The saved address' })
  create(@Req() request: CustomerRequest, @Body() body: unknown) {
    return this.addresses.create(requiredCustomer(request), body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a saved address owned by the signed-in customer' })
  @ApiOkResponse({ description: 'The updated address' })
  update(
    @Req() request: CustomerRequest,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: unknown,
  ) {
    return this.addresses.update(requiredCustomer(request), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a saved address owned by the signed-in customer' })
  @ApiNoContentResponse()
  remove(
    @Req() request: CustomerRequest,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ) {
    return this.addresses.remove(requiredCustomer(request), id);
  }
}

function requiredCustomer(request: CustomerRequest) {
  if (!request.customer) {
    throw new ForbiddenException('Customer access is required');
  }
  return request.customer;
}
