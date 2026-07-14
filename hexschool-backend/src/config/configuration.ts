/**
 * Typed configuration factory. Access via ConfigService.get('app.port') etc.
 * All values are already validated by the Joi schema in env.validation.ts.
 */
export default () => ({
  app: {
    env: process.env.NODE_ENV as string,
    port: parseInt(process.env.PORT ?? '4000', 10),
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    buildSha: process.env.BUILD_SHA ?? 'dev',
    buildTime: process.env.BUILD_TIME || new Date().toISOString(),
  },
  database: {
    url: process.env.DATABASE_URL as string,
  },
  redis: {
    url: process.env.REDIS_URL as string,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET as string,
    refreshSecret: process.env.JWT_REFRESH_SECRET as string,
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT as string,
    region: process.env.S3_REGION ?? 'us-east-1',
    accessKey: process.env.S3_ACCESS_KEY as string,
    secretKey: process.env.S3_SECRET_KEY as string,
    defaultBucket: process.env.S3_BUCKET_DEFAULT as string,
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  },
  smtp: {
    host: process.env.SMTP_HOST as string,
    port: parseInt(process.env.SMTP_PORT ?? '1025', 10),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM as string,
  },
  security: {
    settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY as string,
    rateLimitTtlMs: parseInt(process.env.RATE_LIMIT_TTL_MS ?? '60000', 10),
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
    adminDashUser: process.env.ADMIN_DASH_USER ?? 'admin',
    adminDashPass: process.env.ADMIN_DASH_PASS as string,
  },
});
