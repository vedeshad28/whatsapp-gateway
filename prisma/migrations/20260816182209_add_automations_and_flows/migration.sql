-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "company" TEXT,
ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'open';

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger_type" TEXT NOT NULL,
    "trigger_config" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "execution_count" INTEGER NOT NULL DEFAULT 0,
    "last_executed_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_steps" (
    "id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "parent_step_id" TEXT,
    "branch" TEXT,
    "step_type" TEXT NOT NULL,
    "step_config" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_logs" (
    "id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "trigger_event" TEXT NOT NULL,
    "steps_executed" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_pending_executions" (
    "id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "log_id" TEXT NOT NULL,
    "parent_step_id" TEXT,
    "branch" TEXT,
    "next_step_position" INTEGER NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "run_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_pending_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flows" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "trigger_type" TEXT NOT NULL,
    "trigger_config" JSONB NOT NULL DEFAULT '{}',
    "entry_node_id" TEXT,
    "fallback_policy" JSONB,
    "execution_count" INTEGER NOT NULL DEFAULT 0,
    "last_executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_nodes" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "node_key" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "position_x" INTEGER NOT NULL DEFAULT 0,
    "position_y" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_runs" (
    "id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "conversation_id" TEXT,
    "status" TEXT NOT NULL,
    "current_node_key" TEXT,
    "last_prompt_message_id" TEXT,
    "vars" JSONB NOT NULL DEFAULT '{}',
    "reprompt_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_advanced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "end_reason" TEXT,

    CONSTRAINT "flow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_run_events" (
    "id" TEXT NOT NULL,
    "flow_run_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "node_key" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automations_account_id_trigger_type_idx" ON "automations"("account_id", "trigger_type");

-- CreateIndex
CREATE INDEX "automation_steps_automation_id_idx" ON "automation_steps"("automation_id");

-- CreateIndex
CREATE INDEX "automation_steps_parent_step_id_idx" ON "automation_steps"("parent_step_id");

-- CreateIndex
CREATE INDEX "automation_logs_automation_id_idx" ON "automation_logs"("automation_id");

-- CreateIndex
CREATE INDEX "automation_pending_executions_status_run_at_idx" ON "automation_pending_executions"("status", "run_at");

-- CreateIndex
CREATE INDEX "flows_account_id_trigger_type_idx" ON "flows"("account_id", "trigger_type");

-- CreateIndex
CREATE UNIQUE INDEX "flow_nodes_flow_id_node_key_key" ON "flow_nodes"("flow_id", "node_key");

-- CreateIndex
CREATE INDEX "flow_runs_account_id_contact_id_idx" ON "flow_runs"("account_id", "contact_id");

-- CreateIndex
CREATE INDEX "flow_runs_status_last_advanced_at_idx" ON "flow_runs"("status", "last_advanced_at");

-- CreateIndex
CREATE INDEX "flow_run_events_flow_run_id_idx" ON "flow_run_events"("flow_run_id");

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_steps" ADD CONSTRAINT "automation_steps_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_steps" ADD CONSTRAINT "automation_steps_parent_step_id_fkey" FOREIGN KEY ("parent_step_id") REFERENCES "automation_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_pending_executions" ADD CONSTRAINT "automation_pending_executions_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_pending_executions" ADD CONSTRAINT "automation_pending_executions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_pending_executions" ADD CONSTRAINT "automation_pending_executions_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "automation_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_pending_executions" ADD CONSTRAINT "automation_pending_executions_parent_step_id_fkey" FOREIGN KEY ("parent_step_id") REFERENCES "automation_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flows" ADD CONSTRAINT "flows_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_nodes" ADD CONSTRAINT "flow_nodes_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_run_events" ADD CONSTRAINT "flow_run_events_flow_run_id_fkey" FOREIGN KEY ("flow_run_id") REFERENCES "flow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index, not expressible in the Prisma schema DSL: at
-- most one ACTIVE flow run per contact. This is what makes concurrent
-- webhook deliveries for the same contact collide safely (the losing
-- INSERT hits a unique-violation, caught by the runner) instead of
-- double-advancing a run.
CREATE UNIQUE INDEX "idx_one_active_run_per_contact" ON "flow_runs"("account_id", "contact_id") WHERE "status" = 'active';
