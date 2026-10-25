import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const MONEY = '^\\d{1,10}\\.\\d{2}$';
const moneyDescription = 'Dollars and cents as text, with one to ten whole digits and exactly two decimal digits. This is not a live tariff.';

export class RiderWhatsAppRegistrationBody {
  @ApiProperty({ description: 'Zimbabwe mobile number. A national or +263 form is accepted and stored as E.164.' })
  phone!: string;

  @ApiProperty({ maxLength: 200 })
  fullName!: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  address!: string;

  @ApiProperty({ description: 'Must be true. The account consents to WhatsApp authentication messages.' })
  whatsappConsent!: boolean;
}

export class CustomerWhatsAppRegistrationBody {
  @ApiProperty({ description: 'Zimbabwe mobile number. A national or +263 form is accepted and stored as E.164.' })
  phone!: string;

  @ApiProperty({ enum: ['INDIVIDUAL', 'BUSINESS'] })
  accountKind!: 'INDIVIDUAL' | 'BUSINESS';

  @ApiPropertyOptional({ maxLength: 200 })
  fullName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  businessName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  contactName?: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  address!: string;

  @ApiProperty({ description: 'Must be true. The account consents to WhatsApp authentication messages.' })
  whatsappConsent!: boolean;
}

export class WhatsAppRecoveryBody {
  @ApiProperty({ description: 'Zimbabwe mobile number. A national or +263 form is accepted and stored as E.164.' })
  phone!: string;

  @ApiProperty({ description: 'Must be true. Sign-in codes are sent only with consent to WhatsApp authentication messages.' })
  whatsappConsent!: boolean;
}

export class PhoneBody {
  @ApiProperty({ description: 'Zimbabwe mobile number. A national or +263 form is accepted and stored as E.164.' })
  phone!: string;
}

export class RiderRegistrationBody {
  @ApiProperty({ description: 'Zimbabwe mobile number. A national or +263 form is accepted and stored as E.164.' })
  phone!: string;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Optional. When omitted, the name and address are collected after the number is verified. Rider accounts are individual.',
  })
  fullName?: string;
}

export class RiderRegistrationCompleteBody {
  @ApiProperty({ description: 'Registration proof returned after the rider phone is verified.' })
  registrationToken!: string;

  @ApiProperty({ maxLength: 200 })
  fullName!: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  address!: string;
}

export class IndividualCustomerRegistrationBody {
  @ApiProperty({ description: 'Zimbabwe mobile number. A national or +263 form is accepted and stored as E.164.' })
  phone!: string;

  @ApiProperty({ enum: ['INDIVIDUAL'] })
  accountKind!: 'INDIVIDUAL';

  @ApiProperty({ maxLength: 200 })
  fullName!: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  address!: string;
}

export class BusinessCustomerRegistrationBody {
  @ApiProperty({ description: 'Zimbabwe mobile number. A national or +263 form is accepted and stored as E.164.' })
  phone!: string;

  @ApiProperty({ enum: ['BUSINESS'] })
  accountKind!: 'BUSINESS';

  @ApiProperty({ maxLength: 200 })
  businessName!: string;

  @ApiProperty({ maxLength: 200 })
  contactName!: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  address!: string;
}

export class OtpVerifyBody {
  @ApiProperty({ description: 'The same phone number used to request the code.' })
  phone!: string;

  @ApiProperty({ pattern: '^\\d{4,10}$', description: 'One-time WhatsApp code. Do not put a real code in a saved request.' })
  code!: string;
}

export class CustomerRegistrationCompleteBody {
  @ApiProperty({ description: 'Registration proof returned by customer verification when the account is not created yet.' })
  registrationToken!: string;

  @ApiProperty({ enum: ['INDIVIDUAL', 'BUSINESS'] })
  accountKind!: 'INDIVIDUAL' | 'BUSINESS';

  @ApiPropertyOptional({ maxLength: 200 })
  fullName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  businessName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  contactName?: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  address!: string;
}

export class PendingResponse {
  @ApiProperty({ enum: ['pending'] })
  status!: 'pending';
}

export class LoginUnavailableResponse {
  @ApiProperty({
    enum: ['unavailable'],
    description: 'No sign-in code was sent. An unknown number and a number without this account type return the same response, with no profile details.',
  })
  status!: 'unavailable';
}

export class AdminPendingResponse {
  @ApiProperty({ enum: ['pending'] })
  status!: 'pending';

  @ApiProperty({ format: 'uuid' })
  challengeId!: string;
}

export class RegistrationProofResponse {
  @ApiProperty({ enum: ['verified'] })
  status!: 'verified';

  @ApiProperty({ description: 'Short-lived proof used to finish registration or search places before the account exists. Personal details are included only after the phone has been verified and only when they already belong to that phone.' })
  registrationToken!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  fullName?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional({ nullable: true, minLength: 1, maxLength: 500 })
  address?: string | null;

  @ApiPropertyOptional({ isArray: true, enum: ['fullName', 'phone', 'address'] })
  readOnly?: Array<'fullName' | 'phone' | 'address'>;

  @ApiPropertyOptional({ isArray: true, enum: ['accountKind', 'address'] })
  missing?: Array<'accountKind' | 'address'>;
}

export class SessionResponse {
  @ApiProperty({ description: 'Bearer access token. Do not store an example token in the collection.' })
  accessToken!: string;

  @ApiProperty({ description: 'Rotating refresh token. Do not store an example token in the collection.' })
  refreshToken!: string;

  @ApiProperty({ format: 'date-time' })
  accessTokenExpiresAt!: string;

  @ApiProperty({ format: 'date-time' })
  refreshTokenExpiresAt!: string;
}

export class RefreshBody {
  @ApiProperty({ description: 'Current refresh token. Sending a token again after the response is lost revokes the session family.' })
  refreshToken!: string;
}

export class AdminLoginBody {
  @ApiProperty({ maxLength: 254, format: 'email' })
  email!: string;

  @ApiProperty({ maxLength: 128, minLength: 1, description: 'Admin password. Do not save a real password in the collection.' })
  password!: string;
}

export class AdminVerifyBody {
  @ApiProperty({ format: 'uuid' })
  challengeId!: string;

  @ApiProperty({ pattern: '^\\d{6}$', description: 'Six-digit admin verification code. Do not put a real code in a saved request.' })
  code!: string;
}

export class CoordinateBody {
  @ApiProperty({ description: 'Latitude from -90 to 90. A number or a numeric string is accepted.' })
  latitude!: number;

  @ApiProperty({ description: 'Longitude from -180 to 180. A number or a numeric string is accepted.' })
  longitude!: number;
}

export class QuoteBody {
  @ApiProperty({ type: CoordinateBody })
  pickup!: CoordinateBody;

  @ApiProperty({ type: CoordinateBody })
  dropoff!: CoordinateBody;

  @ApiPropertyOptional({
    enum: ['EXPRESS', 'FLEXIBLE'],
    description: 'Optional. Used only when the marketplace flag is exactly enabled. Otherwise it is ignored.',
  })
  serviceClass?: 'EXPRESS' | 'FLEXIBLE';
}

export class QuoteWindowResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['PEAK', 'OFF_PEAK', 'NIGHT'] })
  kind!: 'PEAK' | 'OFF_PEAK' | 'NIGHT';
}

export class QuoteResponse {
  @ApiProperty()
  distanceMeters!: number;

  @ApiProperty({ type: 'integer' })
  pricingVersion!: number;

  @ApiProperty({ enum: ['USD'] })
  currency!: 'USD';

  @ApiProperty({ pattern: MONEY, description: moneyDescription })
  suggestedPrice!: string;

  @ApiPropertyOptional({ enum: ['FIXED', 'PER_KILOMETRE', 'BASE_PLUS_PER_KILOMETRE', 'DISTANCE_TIERS'] })
  pricingModel?: 'FIXED' | 'PER_KILOMETRE' | 'BASE_PLUS_PER_KILOMETRE' | 'DISTANCE_TIERS';

  @ApiPropertyOptional({ enum: ['EXPRESS', 'FLEXIBLE'] })
  serviceClass?: 'EXPRESS' | 'FLEXIBLE';

  @ApiPropertyOptional({ type: QuoteWindowResponse, nullable: true })
  pricingWindow?: QuoteWindowResponse | null;

  @ApiPropertyOptional({ type: 'integer' })
  basisPoints?: number;
}

export class DeliveryStopBody {
  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;

  @ApiProperty({ maxLength: 500 })
  address!: string;

  @ApiPropertyOptional({ nullable: true })
  placeId?: string | null;

  @ApiProperty({ enum: ['GOOGLE_PLACES', 'DEVICE_GEOCODER'] })
  coordinateSource!: 'GOOGLE_PLACES' | 'DEVICE_GEOCODER';

  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  landmark?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  instructions?: string | null;

  @ApiProperty()
  contactName!: string;

  @ApiProperty({ description: 'Zimbabwe mobile number for this stop.' })
  contactPhone!: string;
}

export class ParcelBody {
  @ApiProperty({ maxLength: 500 })
  description!: string;

  @ApiProperty({ enum: ['SMALL', 'MEDIUM', 'LARGE'] })
  size!: 'SMALL' | 'MEDIUM' | 'LARGE';

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  instructions?: string | null;
}

export class BidSubmissionBody {
  @ApiProperty({ format: 'uuid' })
  deliveryId!: string;

  @ApiProperty({ minimum: 0, description: 'Bid amount in integer cents.' })
  amountCents!: number;

  @ApiPropertyOptional({ enum: ['USD'] })
  currency?: 'USD';
}

export class CreateDeliveryBody {
  @ApiProperty({ type: DeliveryStopBody })
  pickup!: DeliveryStopBody;

  @ApiProperty({ type: DeliveryStopBody })
  dropoff!: DeliveryStopBody;

  @ApiProperty({ type: ParcelBody })
  parcel!: ParcelBody;

  @ApiPropertyOptional({ enum: ['USD'], description: 'Omitted or USD. Any other currency is rejected.' })
  currency?: 'USD';

  @ApiProperty({ pattern: MONEY, description: 'Customer offer greater than zero and at most 1000.00.' })
  offeredPrice!: string;

  @ApiProperty({ enum: ['SENDER', 'RECIPIENT'] })
  payer!: 'SENDER' | 'RECIPIENT';

  @ApiProperty({ enum: ['CASH', 'ECOCASH', 'ONEMONEY', 'INNBUCKS', 'ZIPIT'] })
  paymentMethod!: 'CASH' | 'ECOCASH' | 'ONEMONEY' | 'INNBUCKS' | 'ZIPIT';
}

export class DeliveryPricingBody {
  @ApiPropertyOptional({ enum: ['USD'], description: 'Omitted or USD. Any other currency is rejected.' })
  currency?: 'USD';

  @ApiProperty({ pattern: MONEY, description: `${moneyDescription} Zero is allowed.` })
  baseFee!: string;

  @ApiProperty({ pattern: MONEY, description: `${moneyDescription} Zero is allowed.` })
  pricePerKilometre!: string;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2_000_000_000 })
  minimumTripMetres!: number;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2_000_000_000, description: 'Must be greater than minimumTripMetres.' })
  maximumTripMetres!: number;
}

export class DeliveryPricingResponse {
  @ApiProperty({ type: 'integer' })
  pricingVersion!: number;

  @ApiProperty({ enum: ['USD'] })
  currency!: 'USD';

  @ApiProperty({ pattern: MONEY })
  baseFee!: string;

  @ApiProperty({ pattern: MONEY })
  pricePerKilometre!: string;

  @ApiProperty({ type: 'integer' })
  minimumTripMetres!: number;

  @ApiProperty({ type: 'integer' })
  maximumTripMetres!: number;
}

export class DistanceTierBody {
  @ApiProperty({ type: 'integer', minimum: 1 })
  position!: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 0, nullable: true, description: 'Null only on the final open-ended slice. It ends at the maximum trip.' })
  upToMetres!: number | null;

  @ApiProperty({ pattern: MONEY, description: 'Per-kilometre amount for metres inside this slice. Zero is allowed.' })
  amount!: string;
}

export class PricingWindowBody {
  @ApiProperty({ enum: ['PEAK', 'OFF_PEAK', 'NIGHT'] })
  kind!: 'PEAK' | 'OFF_PEAK' | 'NIGHT';

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ type: [Number], description: 'ISO weekdays, Monday 1 through Sunday 7.' })
  daysOfWeek!: number[];

  @ApiProperty({ description: 'Harare local time, HH:MM. An end at or before the start crosses midnight.' })
  startsAt!: string;

  @ApiProperty({ description: 'Harare local time, HH:MM. The end minute is exclusive.' })
  endsAt!: string;

  @ApiProperty({ type: 'integer', description: 'Basis points added to the unadjusted price. Negative values reduce it.' })
  adjustmentBasisPoints!: number;
}

export class ClassTariffBody {
  @ApiProperty({ enum: ['FIXED', 'PER_KILOMETRE', 'BASE_PLUS_PER_KILOMETRE', 'DISTANCE_TIERS'] })
  pricingModel!: 'FIXED' | 'PER_KILOMETRE' | 'BASE_PLUS_PER_KILOMETRE' | 'DISTANCE_TIERS';

  @ApiPropertyOptional({ enum: ['USD'] })
  currency?: 'USD';

  @ApiPropertyOptional({ pattern: MONEY, description: 'Required for FIXED and BASE_PLUS_PER_KILOMETRE.' })
  baseFee?: string;

  @ApiPropertyOptional({ pattern: MONEY, description: 'Required for PER_KILOMETRE and BASE_PLUS_PER_KILOMETRE.' })
  pricePerKilometre?: string;

  @ApiProperty({ type: 'integer', minimum: 0 })
  minimumTripMetres!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  maximumTripMetres!: number;

  @ApiPropertyOptional({ type: [DistanceTierBody] })
  tiers?: DistanceTierBody[];

  @ApiPropertyOptional({ type: [PricingWindowBody] })
  windows?: PricingWindowBody[];
}

export class DistanceTierResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: 'integer' })
  position!: number;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  upToMetres!: number | null;

  @ApiProperty({ pattern: MONEY })
  amount!: string;
}

export class PricingWindowResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['PEAK', 'OFF_PEAK', 'NIGHT'] })
  kind!: 'PEAK' | 'OFF_PEAK' | 'NIGHT';

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ type: [Number] })
  daysOfWeek!: number[];

  @ApiProperty()
  startsAt!: string;

  @ApiProperty()
  endsAt!: string;

  @ApiProperty({ type: 'integer' })
  adjustmentBasisPoints!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ClassTariffResponse {
  @ApiProperty({ enum: ['EXPRESS', 'FLEXIBLE'] })
  serviceClass!: 'EXPRESS' | 'FLEXIBLE';

  @ApiProperty({ type: 'integer' })
  pricingVersion!: number;

  @ApiProperty({ enum: ['FIXED', 'PER_KILOMETRE', 'BASE_PLUS_PER_KILOMETRE', 'DISTANCE_TIERS'] })
  pricingModel!: 'FIXED' | 'PER_KILOMETRE' | 'BASE_PLUS_PER_KILOMETRE' | 'DISTANCE_TIERS';

  @ApiProperty({ enum: ['USD'] })
  currency!: 'USD';

  @ApiProperty({ pattern: MONEY })
  baseFee!: string;

  @ApiProperty({ pattern: MONEY })
  pricePerKilometre!: string;

  @ApiProperty({ type: 'integer' })
  minimumTripMetres!: number;

  @ApiProperty({ type: 'integer' })
  maximumTripMetres!: number;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ type: [DistanceTierResponse] })
  tiers!: DistanceTierResponse[];

  @ApiProperty({ type: [PricingWindowResponse] })
  windows!: PricingWindowResponse[];
}

export class ClassTariffsResponse {
  @ApiProperty({ type: ClassTariffResponse, nullable: true })
  express!: ClassTariffResponse | null;

  @ApiProperty({ type: ClassTariffResponse, nullable: true })
  flexible!: ClassTariffResponse | null;
}

export class WindowEnabledBody {
  @ApiProperty()
  enabled!: boolean;
}

export class PricingAuditResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  actorId!: string;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  previousVersion!: number | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  nextVersion!: number | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class PricingAuditPagination {
  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  limit!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number;

  @ApiProperty({ type: 'integer', minimum: 0 })
  totalPages!: number;
}

export class PricingAuditPage {
  @ApiProperty({ type: [PricingAuditResponse] })
  data!: PricingAuditResponse[];

  @ApiProperty({ type: PricingAuditPagination })
  pagination!: PricingAuditPagination;
}

export class LocationBody {
  @ApiProperty({ minimum: -90, maximum: 90 })
  latitude!: number;

  @ApiProperty({ minimum: -180, maximum: 180 })
  longitude!: number;
}

export class LocationResponse {
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class MotorcycleBody {
  @ApiProperty({ maxLength: 20, description: 'Registration number. Stored in upper case with collapsed spaces.' })
  registrationNumber!: string;

  @ApiProperty({ maxLength: 80 })
  make!: string;

  @ApiProperty({ maxLength: 80 })
  model!: string;

  @ApiProperty({ maxLength: 40 })
  colour!: string;
}

export class ReleaseOfferBody {
  @ApiProperty({ enum: ['RIDER_CANCELLED', 'VEHICLE_PROBLEM'] })
  reason!: 'RIDER_CANCELLED' | 'VEHICLE_PROBLEM';
}

export class DeliveryStatusBody {
  @ApiProperty({
    enum: ['CREATED', 'SEARCHING', 'NO_RIDER_FOUND', 'ASSIGNED', 'RIDER_ASSIGNED', 'COLLECTING', 'COLLECTED', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DROPOFF', 'DELIVERED', 'CANCELLED', 'FAILED'],
    description: 'The next status. A V2 delivery uses COLLECTING, COLLECTED, and OUT_FOR_DELIVERY. A V1 delivery uses the arrival and transit statuses.',
  })
  status!: string;
}

export class DeliveryProgressResponse {
  @ApiProperty()
  deliveryId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ enum: ['OFFLINE', 'AVAILABLE', 'BUSY'] })
  availability!: 'OFFLINE' | 'AVAILABLE' | 'BUSY';
}

export class RiderSelfProfileResponse {
  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  phone!: string;
}

export class RiderOnboardingResponse {
  @ApiProperty({ enum: ['PENDING', 'VERIFIED', 'REJECTED'] })
  licenceVerificationStatus!: string;

  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED'] })
  approvalStatus!: string;

  @ApiProperty({ enum: ['OFFLINE', 'AVAILABLE', 'BUSY'] })
  availability!: string;

  @ApiProperty({ nullable: true })
  licenceNumber!: string | null;

  @ApiProperty({ nullable: true })
  licenceClass!: string | null;

  @ApiProperty({ nullable: true })
  rejectionReason!: string | null;

  @ApiProperty({ type: 'integer' })
  verifiedMotorcycleCount!: number;

  @ApiProperty()
  activeVerifiedMotorcycle!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Included when the marketplace is enabled. True while this rider is receiving new requests.',
  })
  receiving?: boolean | null;
}

export class AvailabilityResponse {
  @ApiProperty({ enum: ['OFFLINE', 'AVAILABLE', 'BUSY'] })
  availability!: string;
}

export class ReceivingPreferenceBody {
  @ApiProperty()
  receiving!: boolean;
}

export class ReceivingPreferenceResponse {
  @ApiProperty({ enum: ['OFFLINE', 'AVAILABLE', 'BUSY'] })
  availability!: string;

  @ApiProperty()
  receiving!: boolean;
}

export class PushDeviceBody {
  @ApiProperty({ minLength: 1, maxLength: 512 })
  fcmToken!: string;
}

export class PushDeviceResponse {
  @ApiProperty()
  registered!: true;
}

export class IndividualCustomerProfileBody {
  @ApiProperty({ enum: ['INDIVIDUAL'] })
  accountKind!: 'INDIVIDUAL';

  @ApiProperty({ maxLength: 200 })
  fullName!: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  address!: string;
}

export class BusinessCustomerProfileBody {
  @ApiProperty({ enum: ['BUSINESS'] })
  accountKind!: 'BUSINESS';

  @ApiProperty({ maxLength: 200 })
  businessName!: string;

  @ApiProperty({ maxLength: 200 })
  contactName!: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  address!: string;
}

export class CustomerAccountResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['INDIVIDUAL', 'BUSINESS'] })
  kind!: 'INDIVIDUAL' | 'BUSINESS';

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  contactName!: string | null;

  @ApiProperty()
  address!: string;

  @ApiProperty()
  phone!: string;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ description: 'Whether V2 Express and Flexible booking is enabled for this server.' })
  marketplaceEnabled!: boolean;
}

export class CustomerProfileUpdateBody {
  @ApiProperty({ maxLength: 200 })
  fullName!: string;

  @ApiProperty({ nullable: true, description: 'Null clears the email address.' })
  email!: string | null;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  address!: string;
}

export class RiderAvailabilityAlertBody {
  @ApiProperty()
  latitude!: number;

  @ApiProperty()
  longitude!: number;

  @ApiProperty({ description: 'Expo push token for this device.' })
  expoPushToken!: string;
}

export class LicenceVerifyBody {
  @ApiProperty({ enum: ['VERIFY'] })
  decision!: 'VERIFY';

  @ApiProperty({ format: 'uuid' })
  licenceImageId!: string;

  @ApiProperty()
  licenceNumber!: string;

  @ApiProperty()
  licenceClass!: string;
}

export class LicenceRejectBody {
  @ApiProperty({ enum: ['REJECT'] })
  decision!: 'REJECT';

  @ApiProperty({ format: 'uuid' })
  licenceImageId!: string;

  @ApiProperty()
  rejectionReason!: string;
}

export class ApprovalBody {
  @ApiProperty({ enum: ['APPROVE', 'SUSPEND'] })
  decision!: 'APPROVE' | 'SUSPEND';
}

export class MotorcycleVerificationBody {
  @ApiProperty({ enum: ['VERIFY', 'REJECT', 'REVOKE'] })
  decision!: 'VERIFY' | 'REJECT' | 'REVOKE';
}

export class WalletTopUpBody {
  @ApiPropertyOptional({ enum: ['USD'] })
  currency?: 'USD';

  @ApiProperty({ enum: ['CASH', 'ECOCASH'] })
  method!: 'CASH' | 'ECOCASH';

  @ApiProperty({ pattern: MONEY, description: 'Amount greater than zero.' })
  amount!: string;

  @ApiProperty({ enum: [true], description: 'Must be true. The admin confirms the payment was received outside the API.' })
  paymentReceived!: true;

  @ApiPropertyOptional({ nullable: true, description: 'Required for a cash top-up and rejected for EcoCash.' })
  externalReceiptNumber?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Required for an EcoCash top-up and rejected for cash.' })
  ecocashReference?: string | null;
}

export class CommissionPolicyBody {
  @ApiProperty({ enum: ['ON_COMPLETION', 'ON_ACCEPTANCE'] })
  model!: 'ON_COMPLETION' | 'ON_ACCEPTANCE';
}

export class CommissionPolicyResponse {
  @ApiProperty({ enum: ['ON_COMPLETION', 'ON_ACCEPTANCE'] })
  model!: 'ON_COMPLETION' | 'ON_ACCEPTANCE';

  @ApiProperty({ type: 'integer' })
  policyVersion!: number;
}

export class V2CommissionRateBody {
  @ApiProperty({ description: 'A percentage from 0 to 100 with at most two decimal places. 10 is 1000 basis points. 0 is a published rate.' })
  percentage!: string;
}

export class V2CommissionRateResponse {
  @ApiProperty()
  configured!: boolean;

  @ApiPropertyOptional({ type: 'integer', minimum: 0, maximum: 10000 })
  basisPoints?: number;

  @ApiPropertyOptional({ description: 'The percentage without a percent sign. 0 is a published rate.' })
  percentage?: string;

  @ApiPropertyOptional({ type: 'integer' })
  rateVersion?: number;

  @ApiPropertyOptional()
  createdById?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  createdAt?: string;
}

export class V2CommissionAuditResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  actorId!: string;

  @ApiPropertyOptional({ type: 'integer', nullable: true })
  previousVersion!: number | null;

  @ApiProperty({ type: 'integer' })
  nextVersion!: number;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 0, maximum: 10000 })
  previousBasisPoints!: number | null;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 10000 })
  nextBasisPoints!: number;

  @ApiPropertyOptional({ nullable: true })
  previousPercentage!: string | null;

  @ApiProperty()
  nextPercentage!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class V2CommissionAuditPage {
  @ApiProperty({ type: [V2CommissionAuditResponse] })
  data!: V2CommissionAuditResponse[];

  @ApiProperty({ type: PricingAuditPagination })
  pagination!: PricingAuditPagination;
}

export class WalletConfigBody {
  @ApiPropertyOptional({ enum: ['USD'] })
  currency?: 'USD';

  @ApiProperty({ pattern: MONEY, description: `${moneyDescription} Zero is allowed.` })
  welcomeBonus!: string;

  @ApiProperty({ pattern: MONEY, description: `${moneyDescription} Zero is allowed.` })
  defaultBorrowingLimit!: string;

  @ApiProperty({ pattern: MONEY, description: `${moneyDescription} Zero is allowed.` })
  platformFee!: string;
}

export class WalletConfigResponse {
  @ApiProperty({ type: 'integer' })
  configVersion!: number;

  @ApiProperty({ enum: ['USD'] })
  currency!: 'USD';

  @ApiProperty({ pattern: MONEY })
  welcomeBonus!: string;

  @ApiProperty({ pattern: MONEY })
  defaultBorrowingLimit!: string;

  @ApiProperty({ pattern: MONEY })
  platformFee!: string;
}
