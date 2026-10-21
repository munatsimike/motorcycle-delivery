import { describe, expect, it } from 'vitest';
import { adminCorsOptions, adminWebOrigin, helmetResourcePolicy } from './admin-cors.js';

describe('admin web origin', () => {
  it('stays closed when the admin origin is missing or unrestricted', () => {
    expect(adminCorsOptions({})).toBeNull();
    expect(adminCorsOptions({ ADMIN_WEB_ORIGIN: '  ' })).toBeNull();
    expect(adminCorsOptions({ ADMIN_WEB_ORIGIN: '*' })).toBeNull();
    expect(adminWebOrigin({ ADMIN_WEB_ORIGIN: 'https://admin.example/riders' })).toBeNull();
    expect(adminWebOrigin({ ADMIN_WEB_ORIGIN: 'https://user:secret@admin.example' })).toBeNull();
    expect(helmetResourcePolicy({})).toBe('same-origin');
  });

  it('allows only the configured origin for the admin methods and headers', () => {
    expect(adminCorsOptions({ ADMIN_WEB_ORIGIN: 'http://localhost:5173/' })).toEqual({
      origin: 'http://localhost:5173',
      methods: ['GET', 'POST', 'PUT'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      credentials: false,
    });
    expect(adminWebOrigin({ ADMIN_WEB_ORIGIN: 'https://admin.example' })).toBe('https://admin.example');
    expect(helmetResourcePolicy({ ADMIN_WEB_ORIGIN: 'https://admin.example' })).toBe('cross-origin');
  });
});
