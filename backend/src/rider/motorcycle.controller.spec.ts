import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { MotorcycleReviewController } from './motorcycle-review.controller.js';
import { MotorcycleController } from './motorcycle.controller.js';

describe('motorcycle controllers', () => {
  it('requires the authenticated rider or admin', () => {
    const motorcycles = new MotorcycleController({} as never);
    expect(() => motorcycles.list({})).toThrow(ForbiddenException);

    const reviews = new MotorcycleReviewController({} as never, {} as never);
    expect(() => reviews.review({}, 'bike-1', { decision: 'VERIFY' })).toThrow(ForbiddenException);
    expect(() => reviews.review({ admin: { userId: 'admin-1' } }, 'bike-1', { decision: 'CLOSE' })).toThrow(BadRequestException);
  });
});
