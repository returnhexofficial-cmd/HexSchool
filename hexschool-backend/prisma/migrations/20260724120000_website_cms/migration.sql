-- ── Module 19: Website CMS (Public Site) ──────────────────────────────

-- The settings registry stores its group in this PG enum. `website` joins
-- it so the new `website.*` keys validate. Safe inside the migration
-- transaction because no row in THIS migration uses the new value
-- (settings rows are written at runtime by the registry seeder).
ALTER TYPE "settings_group_enum" ADD VALUE IF NOT EXISTS 'website';

-- CreateEnum
CREATE TYPE "web_content_status_enum" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "cms_page_template_enum" AS ENUM ('DEFAULT', 'LANDING', 'CONTACT');

-- CreateEnum
CREATE TYPE "news_category_enum" AS ENUM ('NEWS', 'BLOG', 'ACHIEVEMENT');

-- CreateEnum
CREATE TYPE "gallery_item_type_enum" AS ENUM ('IMAGE', 'VIDEO_URL');

-- CreateEnum
CREATE TYPE "contact_message_status_enum" AS ENUM ('NEW', 'READ', 'REPLIED');

-- CreateEnum
CREATE TYPE "career_application_status_enum" AS ENUM ('RECEIVED', 'SHORTLISTED', 'REJECTED');

-- CreateTable
CREATE TABLE "cms_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "title_bn" VARCHAR(200),
    "content" TEXT NOT NULL,
    "content_bn" TEXT,
    "excerpt" VARCHAR(500),
    "meta_title" VARCHAR(200),
    "meta_description" VARCHAR(320),
    "og_image_url" VARCHAR(500),
    "status" "web_content_status_enum" NOT NULL DEFAULT 'DRAFT',
    "template" "cms_page_template_enum" NOT NULL DEFAULT 'DEFAULT',
    "show_in_menu" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "cms_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "title_bn" VARCHAR(200),
    "excerpt" VARCHAR(500),
    "content" TEXT NOT NULL,
    "content_bn" TEXT,
    "cover_url" VARCHAR(500),
    "category" "news_category_enum" NOT NULL DEFAULT 'NEWS',
    "meta_title" VARCHAR(200),
    "meta_description" VARCHAR(320),
    "status" "web_content_status_enum" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "news_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "galleries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "title_bn" VARCHAR(200),
    "description" VARCHAR(1000),
    "event_date" DATE,
    "cover_url" VARCHAR(500),
    "status" "web_content_status_enum" NOT NULL DEFAULT 'DRAFT',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "galleries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "gallery_id" UUID NOT NULL,
    "type" "gallery_item_type_enum" NOT NULL DEFAULT 'IMAGE',
    "url" VARCHAR(500) NOT NULL,
    "caption" VARCHAR(300),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "gallery_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "downloads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "title_bn" VARCHAR(200),
    "category" VARCHAR(80),
    "file_url" VARCHAR(500) NOT NULL,
    "file_key" VARCHAR(500),
    "size_bytes" INTEGER,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "status" "web_content_status_enum" NOT NULL DEFAULT 'DRAFT',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "downloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "careers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "location" VARCHAR(200),
    "vacancies" INTEGER,
    "deadline" DATE,
    "status" "web_content_status_enum" NOT NULL DEFAULT 'DRAFT',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "careers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "career_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(150),
    "cv_url" VARCHAR(500) NOT NULL,
    "cv_key" VARCHAR(500),
    "note" VARCHAR(1000),
    "status" "career_application_status_enum" NOT NULL DEFAULT 'RECEIVED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "career_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "question" VARCHAR(300) NOT NULL,
    "question_bn" VARCHAR(300),
    "answer" TEXT NOT NULL,
    "answer_bn" TEXT,
    "category" VARCHAR(80),
    "status" "web_content_status_enum" NOT NULL DEFAULT 'PUBLISHED',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "name_bn" VARCHAR(150),
    "designation" VARCHAR(150) NOT NULL,
    "photo_url" VARCHAR(500),
    "message" TEXT,
    "status" "web_content_status_enum" NOT NULL DEFAULT 'PUBLISHED',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "committee_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(150),
    "subject" VARCHAR(200),
    "body" TEXT NOT NULL,
    "status" "contact_message_status_enum" NOT NULL DEFAULT 'NEW',
    "ip" VARCHAR(64),
    "read_at" TIMESTAMPTZ(6),
    "replied_at" TIMESTAMPTZ(6),
    "reply_note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_cms_pages_status" ON "cms_pages"("school_id", "status");

-- CreateIndex
CREATE INDEX "idx_news_posts_feed" ON "news_posts"("school_id", "category", "status", "published_at");

-- CreateIndex
CREATE INDEX "idx_galleries_status" ON "galleries"("school_id", "status", "display_order");

-- CreateIndex
CREATE INDEX "idx_gallery_items_gallery" ON "gallery_items"("gallery_id", "display_order");

-- CreateIndex
CREATE INDEX "idx_downloads_status" ON "downloads"("school_id", "status", "display_order");

-- CreateIndex
CREATE INDEX "idx_careers_status" ON "careers"("school_id", "status", "deadline");

-- CreateIndex
CREATE INDEX "idx_career_applications_career" ON "career_applications"("school_id", "career_id", "status");

-- CreateIndex
CREATE INDEX "idx_faqs_status" ON "faqs"("school_id", "status", "display_order");

-- CreateIndex
CREATE INDEX "idx_committee_members_status" ON "committee_members"("school_id", "status", "display_order");

-- CreateIndex
CREATE INDEX "idx_contact_messages_status" ON "contact_messages"("school_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "cms_pages" ADD CONSTRAINT "fk_cms_pages_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_posts" ADD CONSTRAINT "fk_news_posts_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "galleries" ADD CONSTRAINT "fk_galleries_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_items" ADD CONSTRAINT "fk_gallery_items_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gallery_items" ADD CONSTRAINT "fk_gallery_items_gallery" FOREIGN KEY ("gallery_id") REFERENCES "galleries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downloads" ADD CONSTRAINT "fk_downloads_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "careers" ADD CONSTRAINT "fk_careers_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_applications" ADD CONSTRAINT "fk_career_applications_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_applications" ADD CONSTRAINT "fk_career_applications_career" FOREIGN KEY ("career_id") REFERENCES "careers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faqs" ADD CONSTRAINT "fk_faqs_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_members" ADD CONSTRAINT "fk_committee_members_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_messages" ADD CONSTRAINT "fk_contact_messages_school" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written constraints (Prisma cannot express these) ────────────

-- A slug is the public URL of a page, so it must be unique per school —
-- among LIVE rows only, so deleting `/about` frees the slug for a rewrite
-- (the M06/M16/M17 partial-unique-excluding-tombstones pattern).
CREATE UNIQUE INDEX "uq_cms_pages_slug"
  ON "cms_pages" ("school_id", "slug")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "uq_news_posts_slug"
  ON "news_posts" ("school_id", "slug")
  WHERE "deleted_at" IS NULL;

-- Publication evidence (the M16/M17 rule: a state that claims something
-- happened must record WHEN). `published_at` is also the feed sort key
-- and the RSS <pubDate>, so a PUBLISHED row without one would sort last
-- and syndicate undated.
ALTER TABLE "cms_pages"
  ADD CONSTRAINT "chk_cms_pages_published_evidence"
  CHECK ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL);

ALTER TABLE "news_posts"
  ADD CONSTRAINT "chk_news_posts_published_evidence"
  CHECK ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL);

-- The download counter is the one column an anonymous visitor can move.
-- It only ever goes up; this is the backstop under the service's
-- `increment` (never a client-supplied value).
ALTER TABLE "downloads"
  ADD CONSTRAINT "chk_downloads_count"
  CHECK ("download_count" >= 0 AND ("size_bytes" IS NULL OR "size_bytes" >= 0));

-- Ordering columns are non-negative everywhere content is hand-sorted.
ALTER TABLE "cms_pages"
  ADD CONSTRAINT "chk_cms_pages_display_order" CHECK ("display_order" >= 0);
ALTER TABLE "galleries"
  ADD CONSTRAINT "chk_galleries_display_order" CHECK ("display_order" >= 0);
ALTER TABLE "gallery_items"
  ADD CONSTRAINT "chk_gallery_items_display_order" CHECK ("display_order" >= 0);
ALTER TABLE "downloads"
  ADD CONSTRAINT "chk_downloads_display_order" CHECK ("display_order" >= 0);
ALTER TABLE "careers"
  ADD CONSTRAINT "chk_careers_display_order"
  CHECK ("display_order" >= 0 AND ("vacancies" IS NULL OR "vacancies" > 0));
ALTER TABLE "faqs"
  ADD CONSTRAINT "chk_faqs_display_order" CHECK ("display_order" >= 0);
ALTER TABLE "committee_members"
  ADD CONSTRAINT "chk_committee_members_display_order" CHECK ("display_order" >= 0);

-- A REPLIED message must record when it was replied to, and a READ one
-- when it was read — the same "evidence, not a bare flag" rule as
-- `chk_notifications_status_evidence` (M17).
ALTER TABLE "contact_messages"
  ADD CONSTRAINT "chk_contact_messages_status_evidence"
  CHECK (
    ("status" <> 'REPLIED' OR "replied_at" IS NOT NULL)
    AND ("status" = 'NEW' OR "read_at" IS NOT NULL)
  );

-- A contact message with no way to reply is a dead letter: at least one
-- of phone/email must be present (the form enforces it client-side too).
ALTER TABLE "contact_messages"
  ADD CONSTRAINT "chk_contact_messages_reachable"
  CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL);
