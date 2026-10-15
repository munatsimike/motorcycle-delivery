import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
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
    ]);

    return {
      deliveries: {
        total: totalDeliveries,
        active: activeDeliveries,
        completed: completedDeliveries,
        cancelled: cancelledDeliveries,
      },
      riders: {
        total: totalRiders,
        pending: pendingRiders,
        approved: approvedRiders,
        suspended: suspendedRiders,
        rejected: rejectedRiders,
      },
    };
  }
}
