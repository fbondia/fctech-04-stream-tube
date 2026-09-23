import { envValidationSchema } from './env.validation';

const base = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh',
  VIDEO_INFRA_ENABLED: 'true',
  S3_API_ACCESS_KEY: 'api',
  S3_API_SECRET_KEY: 'api-secret',
  S3_WORKER_ACCESS_KEY: 'worker',
  S3_WORKER_SECRET_KEY: 'worker-secret',
};

describe('video infrastructure configuration', () => {
  it('requires separate storage credentials when enabled', () => {
    const { error } = envValidationSchema.validate(
      { ...base, S3_WORKER_SECRET_KEY: undefined },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error?.message).toContain('S3_WORKER_SECRET_KEY');
  });

  it('rejects upload above 10 GB and unsafe worker concurrency', () => {
    const { error } = envValidationSchema.validate(
      { ...base, VIDEO_MAX_BYTES: 10_000_000_001, VIDEO_WORKER_CONCURRENCY: 0 },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error?.message).toContain('VIDEO_MAX_BYTES');
    expect(error?.message).toContain('VIDEO_WORKER_CONCURRENCY');
  });
});
