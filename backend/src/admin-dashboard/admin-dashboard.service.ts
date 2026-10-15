import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      totalDeliveries,
      activeDeliveries,
      completedDeliveries,
      cancelledDeliveries,
      totalRiders,
      pendingRiders,
      approvedRiders,
      suspendedRiders,
      rejectedRiders,
      totalMotorcycles,
      pendingMotorcycles,
      verifiedMotorcycles,
      rejectedMotorcycles,
      revokedMotorcycles,
      offlineRiders,
      availableRiders,
      busyRiders,
      deliveryStatusGroups,
      deliveriesLast24Hours,
    ] = await this.prisma.$transaction([
      this.prisma.delivery.count(),
      this.prisma.delivery.count({
        where: {
          status: {
            in: [
              'SEARCHING',
              'ASSIGNED',
              'ARRIVED_AT_PICKUP',
              'PICKED_UP',
              'IN_TRANSIT',
              'ARRIVED_AT_DROPOFF',
            ],
          },
        },
      }),
      this.prisma.delivery.count({
        where: { status: 'DELIVERED' },
      }),
      this.prisma.delivery.count({
        where: { status: 'CANCELLED' },
      }),
      this.prisma.riderProfile.count(),
      this.prisma.riderProfile.count({
        where: { approvalStatus: 'PENDING' },
      }),
      this.prisma.riderProfile.count({
        where: { approvalStatus: 'APPROVED' },
      }),
      this.prisma.riderProfile.count({
        where: { approvalStatus: 'SUSPENDED' },
      }),
      this.prisma.riderProfile.count({
        where: { approvalStatus: 'REJECTED' },
      }),
      this.prisma.motorcycle.count(),
      this.prisma.motorcycle.count({
        where: { verificationStatus: 'PENDING' },
      }),
      this.prisma.motorcycle.count({
        where: { verificationStatus: 'VERIFIED' },
      }),
      this.prisma.motorcycle.count({
        where: { verificationStatus: 'REJECTED' },
      }),
      this.prisma.motorcycle.count({
        where: { verificationStatus: 'REVOKED' },
      }),
      this.prisma.riderProfile.count({
        where: { approvalStatus: 'APPROVED', availability: 'OFFLINE' },
      }),
      this.prisma.riderProfile.count({
        where: { approvalStatus: 'APPROVED', availability: 'AVAILABLE' },
      }),
      this.prisma.riderProfile.count({
        where: { approvalStatus: 'APPROVED', availability: 'BUSY' },
      }),
      this.prisma.delivery.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.delivery.count({
        where: { createdAt: { gte: last24Hours } },
      }),
    ]);

    const statusCounts: Record<string, number> = {
      CREATED: 0,
      SEARCHING: 0,
      NO_RIDER_FOUND: 0,
      ASSIGNED: 0,
      ARRIVED_AT_PICKUP: 0,
      PICKED_UP: 0,
      IN_TRANSIT: 0,
      ARRIVED_AT_DROPOFF: 0,
      DELIVERED: 0,
      CANCELLED: 0,
      FAILED: 0,
    };

    for (const group of deliveryStatusGroups) {
      statusCounts[group.status] = group._count._all;
    }

    return {
      deliveries: {
        total: totalDeliveries,
        active: activeDeliveries,
        completed: completedDeliveries,
        cancelled: cancelledDeliveries,
        byStatus: statusCounts,
        last24Hours: deliveriesLast24Hours,
      },
      riders: {
        total: totalRiders,
        pending: pendingRiders,
        approved: approvedRiders,
        suspended: suspendedRiders,
        rejected: rejectedRiders,
        availability: {
          offline: offlineRiders,
          available: availableRiders,
          busy: busyRiders,
        },
      },
      motorcycles: {
        total: totalMotorcycles,
        pending: pendingMotorcycles,
        verified: verifiedMotorcycles,
        rejected: rejectedMotorcycles,
        revoked: revokedMotorcycles,
      },
    };
  }
}
