-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('sending', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "BroadcastRecipientStatus" AS ENUM ('pending', 'sent', 'delivered', 'read', 'failed');

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "audience_tag_id" TEXT,
    "body_params" JSONB,
    "use_contact_name_var" INTEGER,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'sending',
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_recipients" (
    "id" TEXT NOT NULL,
    "broadcast_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "status" "BroadcastRecipientStatus" NOT NULL DEFAULT 'pending',
    "message_id" TEXT,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broadcasts_account_id_idx" ON "broadcasts"("account_id");

-- CreateIndex
CREATE INDEX "broadcast_recipients_broadcast_id_idx" ON "broadcast_recipients"("broadcast_id");

-- CreateIndex
CREATE INDEX "broadcast_recipients_message_id_idx" ON "broadcast_recipients"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_broadcast_id_contact_id_key" ON "broadcast_recipients"("broadcast_id", "contact_id");

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "message_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_audience_tag_id_fkey" FOREIGN KEY ("audience_tag_id") REFERENCES "tags"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
