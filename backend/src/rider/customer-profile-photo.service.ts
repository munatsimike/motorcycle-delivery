import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AssignmentStatus, BidStatus, ProfilePhotoStatus } from '../generated/prisma/client.js';
import type { CustomerContext } from '../auth/customer-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ObjectStorage } from './object-storage.js';
import type { ProfilePhotoBytes } from './profile-photo.service.js';
import { logStorageFailure } from './storage-log.js';

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CustomerProfilePhotoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
  ) {}

  async bidImage(customer: CustomerContext, deliveryId: string, bidId: string): Promise<ProfilePhotoBytes> {
    if (!UUID_TEXT.test(deliveryId) || !UUID_TEXT.test(bidId)) {
      throw new NotFoundException('Delivery not found');
    }
    await this.ownedDelivery(customer, deliveryId);
    const bid = await this.prisma.bid.findFirst({
      where: { id: bidId, deliveryId, status: BidStatus.OPEN },
      select: { riderProfileId: true },
    });
    if (!bid) {
      throw new NotFoundException('No profile photo has been uploaded');
    }
    return this.storedImage(bid.riderProfileId);
  }

  async assignedImage(customer: CustomerContext, deliveryId: string): Promise<ProfilePhotoBytes> {
    if (!UUID_TEXT.test(deliveryId)) {
      throw new NotFoundException('Delivery not found');
    }
    await this.ownedDelivery(customer, deliveryId);
    const assignment = await this.prisma.deliveryAssignment.findFirst({
      where: { deliveryId, status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED] } },
      orderBy: { createdAt: 'desc' },
      select: { riderProfileId: true },
    });
    if (!assignment) {
      throw new NotFoundException('No profile photo has been uploaded');
    }
    return this.storedImage(assignment.riderProfileId);
  }

  private async ownedDelivery(customer: CustomerContext, deliveryId: string): Promise<void> {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, customerId: customer.customerAccountId },
      select: { id: true },
    });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
  }

  private async storedImage(riderProfileId: string): Promise<ProfilePhotoBytes> {
    const photo = await this.prisma.riderProfilePhoto.findFirst({
      where: { riderProfileId, status: ProfilePhotoStatus.STORED },
    });
    if (!photo?.contentType) {
      throw new NotFoundException('No profile photo has been uploaded');
    }
    try {
      const bytes = await this.storage.get(photo.objectKey);
      return { bytes, contentType: photo.contentType };
    } catch (error) {
      logStorageFailure(error, 'Profile photo');
      throw new ServiceUnavailableException('Profile photo storage is unavailable');
    }
  }
}
