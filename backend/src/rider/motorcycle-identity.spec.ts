import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { readMotorcycleIdentity } from './motorcycle-identity.js';

describe('motorcycle identity', () => {
  it('normalizes registration numbers and vehicle text', () => {
    expect(readMotorcycleIdentity({
      registrationNumber: ' ab  123 ',
      make: ' Honda ',
      model: '  CB  125 ',
      colour: ' red ',
    })).toEqual({
      registrationNumber: 'AB 123',
      make: 'Honda',
      model: 'CB 125',
      colour: 'red',
    });
  });

  it('rejects blank or oversized identity fields', () => {
    expect(() => readMotorcycleIdentity({ registrationNumber: '   ', make: 'Honda', model: 'CB', colour: 'red' }))
      .toThrow(BadRequestException);
    expect(() => readMotorcycleIdentity({ registrationNumber: 'A'.repeat(21), make: 'Honda', model: 'CB', colour: 'red' }))
      .toThrow(BadRequestException);
    expect(() => readMotorcycleIdentity({ registrationNumber: 'AB', make: ' ', model: 'CB', colour: 'red' }))
      .toThrow(BadRequestException);
  });
});
