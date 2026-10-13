import { ConflictException, NotFoundException } from '@nestjs/common';
import { AssignmentStatus, Prisma, RiderAvailability } from '../generated/prisma/client.js';

export async function lockRiderProfile(
  tx: Prisma.TransactionClient,
  riderProfileId: string,
  missingMessage = 'Motorcycle not found',
) {
  await tx.$queryRaw`
    SELECT "id" FROM "rider_profiles" WHERE "id" = CAST(${riderProfileId} AS uuid) FOR UPDATE
  `;
  const profile = await tx.riderProfile.findUnique({ where: { id: riderProfileId } });
  if (!profile) {
    throw new NotFoundException(missingMessage);
  }
  return profile;
}

export async function lockRiderLicenceImages(tx: Prisma.TransactionClient, riderProfileId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "rider_licence_images" WHERE "rider_profile_id" = CAST(${riderProfileId} AS uuid) FOR UPDATE
  `;
}

export async function lockLicenceImage(
  tx: Prisma.TransactionClient,
  licenceImageId: string,
  riderProfileId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "rider_licence_images"
    WHERE "id" = CAST(${licenceImageId} AS uuid)
      AND "rider_profile_id" = CAST(${riderProfileId} AS uuid)
    FOR UPDATE
  `;
}

export async function lockRiderMotorcycles(tx: Prisma.TransactionClient, riderProfileId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "motorcycles" WHERE "rider_profile_id" = CAST(${riderProfileId} AS uuid) FOR UPDATE
  `;
}

export async function lockMotorcycle(tx: Prisma.TransactionClient, motorcycleId: string, riderProfileId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "motorcycles"
    WHERE "id" = CAST(${motorcycleId} AS uuid)
      AND "rider_profile_id" = CAST(${riderProfileId} AS uuid)
    FOR UPDATE
  `;
}

export async function hasAcceptedAssignment(tx: Prisma.TransactionClient, riderProfileId: string): Promise<boolean> {
  const accepted = await tx.deliveryAssignment.findFirst({
    where: { riderProfileId, status: AssignmentStatus.ACCEPTED },
    select: { id: true },
  });
  return accepted !== null;
}

export function assertCanChangeMotorcycle(availability: RiderAvailability, accepted: boolean): void {
  if (availability !== RiderAvailability.OFFLINE || accepted) {
    throw new ConflictException('Motorcycles can only be changed while offline and not on a delivery');
  }
}
