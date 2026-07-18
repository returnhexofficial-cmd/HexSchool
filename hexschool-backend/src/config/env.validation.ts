import * as Joi from 'joi';

/**
 * Fail-fast environment validation. The app refuses to boot when a required
 * variable is missing or malformed (Module 01 business rule).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development'),
  PORT: Joi.number().port().default(4000),

  // Database
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),

  // Redis (cache + BullMQ)
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),

  // JWT (consumed from Module 02 onward, validated from day one)
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),

  // S3-compatible object storage (MinIO in dev)
  S3_ENDPOINT: Joi.string().uri().required(),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_ACCESS_KEY: Joi.string().required(),
  S3_SECRET_KEY: Joi.string().required(),
  S3_BUCKET_DEFAULT: Joi.string().required(),
  S3_FORCE_PATH_STYLE: Joi.boolean().default(true),

  // SMTP (Mailpit in dev)
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().port().required(),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  SMTP_FROM: Joi.string().required(),

  // Google reCAPTCHA (M10 public admission forms; empty = verification
  // disabled — dev/test convenience, set both keys in production)
  RECAPTCHA_SECRET_KEY: Joi.string().allow('').default(''),

  // Security
  CORS_ORIGINS: Joi.string().required(), // comma-separated whitelist
  SETTINGS_ENCRYPTION_KEY: Joi.string().length(32).required(), // AES-256 key (32 bytes)
  RATE_LIMIT_TTL_MS: Joi.number().default(60_000),
  RATE_LIMIT_MAX: Joi.number().default(100),

  // Ops dashboards (Swagger in prod, Bull Board always)
  ADMIN_DASH_USER: Joi.string().default('admin'),
  ADMIN_DASH_PASS: Joi.string().min(8).required(),

  // Build metadata (injected by CI/Docker; defaults for local dev)
  BUILD_SHA: Joi.string().default('dev'),
  BUILD_TIME: Joi.string().allow('').default(''),
});
