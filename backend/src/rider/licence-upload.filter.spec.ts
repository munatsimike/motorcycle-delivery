import { PayloadTooLargeException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { licenceUploadException } from './licence-upload.filter.js';

describe('licence upload errors', () => {
  it('maps an incoming file over the multipart limit to HTTP 413', () => {
    const mapped = licenceUploadException({ name: 'MulterError', code: 'LIMIT_FILE_SIZE' });
    expect(mapped).toBeInstanceOf(PayloadTooLargeException);
  });
});
