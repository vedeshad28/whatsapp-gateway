// ============================================================
// Converts between the builder's nested step tree (what a
// `condition` step's yes/no branches contain) and the DB's flat
// `AutomationStep` rows (parentStepId/branch/position). Pure,
// DB-shape-agnostic — same design as wacrm's pre-trim
// src/lib/automations/steps-tree.ts, ported onto Prisma-shaped rows.
// ============================================================

import { randomUUID } from 'node:crypto';

export interface BuilderStep {
  stepType: string;
  stepConfig: Record<string, unknown>;
  /** Only present for stepType === 'condition'. */
  branches?: { yes: BuilderStep[]; no: BuilderStep[] };
}

export interface FlatStepRow {
  id: string;
  automationId: string;
  parentStepId: string | null;
  branch: string | null;
  stepType: string;
  stepConfig: Record<string, unknown>;
  position: number;
}

/** Nested tree -> flat rows ready for `prisma.automationStep.createMany`. IDs are generated up front so children can reference their real parent id in the same batch. */
export function flattenSteps(steps: BuilderStep[], automationId: string): FlatStepRow[] {
  const out: FlatStepRow[] = [];

  function walk(list: BuilderStep[], parentStepId: string | null, branch: string | null) {
    list.forEach((step, index) => {
      const id = randomUUID();
      out.push({
        id,
        automationId,
        parentStepId,
        branch,
        stepType: step.stepType,
        stepConfig: step.stepConfig,
        position: index,
      });
      if (step.stepType === 'condition' && step.branches) {
        walk(step.branches.yes, id, 'yes');
        walk(step.branches.no, id, 'no');
      }
    });
  }

  walk(steps, null, null);
  return out;
}

interface DbStepRow {
  id: string;
  parentStepId: string | null;
  branch: string | null;
  stepType: string;
  stepConfig: unknown;
  position: number;
}

/** Flat DB rows -> the builder's nested tree. */
export function loadStepsTree(rows: DbStepRow[]): BuilderStep[] {
  function childrenOf(parentStepId: string | null, branch: string | null): DbStepRow[] {
    return rows
      .filter((r) => r.parentStepId === parentStepId && r.branch === branch)
      .sort((a, b) => a.position - b.position);
  }

  function build(parentStepId: string | null, branch: string | null): BuilderStep[] {
    return childrenOf(parentStepId, branch).map((row) => {
      const step: BuilderStep = {
        stepType: row.stepType,
        stepConfig: (row.stepConfig ?? {}) as Record<string, unknown>,
      };
      if (row.stepType === 'condition') {
        step.branches = { yes: build(row.id, 'yes'), no: build(row.id, 'no') };
      }
      return step;
    });
  }

  return build(null, null);
}
