-- DropForeignKey
ALTER TABLE "workspace_invitations" DROP CONSTRAINT "workspace_invitations_invited_by_id_fkey";

-- AlterTable
ALTER TABLE "workspace_invitations" ALTER COLUMN "invited_by_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "linked_account_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_linked_account_id_key" ON "workspaces"("linked_account_id");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_linked_account_id_fkey" FOREIGN KEY ("linked_account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
