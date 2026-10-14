import { PrismaClient } from '../dist/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashAdminPassword } from '../dist/auth/admin-password.js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

if (!process.env.DATABASE_URL) {
  process.loadEnvFile('.env');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});

const rl = createInterface({ input: stdin, output: stdout });

try {
  const email = (process.env.RIDERS_ADMIN_SETUP_EMAIL ?? '').trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Invalid email address');
  }

  const admin = await prisma.user.findFirst({
    where: {
      role: 'ADMIN',
      createdAt: new Date('2026-10-14T08:22:20.768Z'),
      accountStatus: 'ACTIVE',
      email: null,
      passwordHash: null,
    },
    select: { id: true },
  });

  if (!admin) {
    throw new Error('Admin 2 is not eligible for provisioning');
  }

  const password = process.env.RIDERS_ADMIN_SETUP_PASSWORD;

  if (!password) {
    throw new Error('Provisioning password was not provided');
  }
  const passwordHash = await hashAdminPassword(password);

  const result = await prisma.user.updateMany({
    where: {
      id: admin.id,
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      email: null,
      passwordHash: null,
    },
    data: { email, passwordHash },
  });

  if (result.count !== 1) {
    throw new Error('Provisioning aborted: admin account changed');
  }

  console.log('Admin 2 credentials configured successfully.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Provisioning failed');
  process.exitCode = 1;
} finally {
  rl.close();
  await prisma.$disconnect();
}



