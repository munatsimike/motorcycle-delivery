import { Body, Controller, ForbiddenException, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse, getSchemaPath } from '@nestjs/swagger';
import { CustomerAccessGuard, CustomerSessionGuard, type CustomerRequest, type CustomerSessionRequest } from '../auth/customer-access.guard.js';
import { BusinessCustomerProfileBody, CustomerAccountResponse, CustomerProfileUpdateBody, IndividualCustomerProfileBody } from '../openapi/schemas.js';
import { CustomerAccountService } from './customer-account.service.js';

@ApiTags('Customer account')
@ApiBearerAuth('bearer')
@ApiExtraModels(IndividualCustomerProfileBody, BusinessCustomerProfileBody)
@ApiUnauthorizedResponse({ description: 'Authentication failed' })
@ApiForbiddenResponse({ description: 'Customer access is required' })
@Controller('customers/me')
export class CustomerAccountController {
  constructor(private readonly accounts: CustomerAccountService) {}

  @Post()
  @HttpCode(200)
  @UseGuards(CustomerSessionGuard)
  @ApiOperation({ summary: 'Activate a customer account from a verified phone session' })
  @ApiBody({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(IndividualCustomerProfileBody) },
        { $ref: getSchemaPath(BusinessCustomerProfileBody) },
      ],
    },
  })
  @ApiOkResponse({ type: CustomerAccountResponse })
  activate(@Req() request: CustomerSessionRequest, @Body() body: unknown) {
    if (!request.customerSession) {
      throw new ForbiddenException('Customer access is required');
    }
    return this.accounts.activate(request.customerSession, body);
  }

  @Patch()
  @UseGuards(CustomerAccessGuard)
  @ApiOperation({ summary: 'Update the customer profile' })
  @ApiBody({ type: CustomerProfileUpdateBody })
  @ApiOkResponse({ type: CustomerAccountResponse })
  update(@Req() request: CustomerRequest, @Body() body: unknown) {
    if (!request.customer) {
      throw new ForbiddenException('Customer access is required');
    }
    return this.accounts.update(request.customer, body);
  }

  @Get()
  @UseGuards(CustomerAccessGuard)
  @ApiOperation({ summary: 'Read the signed-in customer account' })
  @ApiOkResponse({ type: CustomerAccountResponse })
  current(@Req() request: CustomerRequest) {
    if (!request.customer) {
      throw new ForbiddenException('Customer access is required');
    }
    return this.accounts.current(request.customer);
  }
}
