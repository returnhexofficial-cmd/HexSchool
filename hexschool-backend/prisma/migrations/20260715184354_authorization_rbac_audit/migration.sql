-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(100) NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "is_orphaned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_role_permissions" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_user_roles" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "school_id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(32) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(64),
    "old_values" JSONB,
    "new_values" JSONB,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_permissions_code" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "idx_roles_school" ON "roles"("school_id");

-- CreateIndex
CREATE INDEX "idx_role_permissions_permission" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "idx_user_roles_role" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs"("school_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "idx_audit_logs_user_created" ON "audit_logs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role_permissions_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "fk_user_roles_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "fk_user_roles_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written section (features Prisma cannot express in schema) ──
-- Soft-delete-aware slug uniqueness: a deleted role releases its slug.
CREATE UNIQUE INDEX "uq_roles_slug" ON "roles" ("school_id", "slug")
  WHERE "deleted_at" IS NULL;

-- Role slugs are kebab-case (roadmap M03 §7).
ALTER TABLE "roles" ADD CONSTRAINT "chk_roles_slug_kebab"
  CHECK ("slug" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$');
