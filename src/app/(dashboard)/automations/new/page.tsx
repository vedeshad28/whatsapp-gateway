'use client';

import { useAuth } from '@/hooks/use-auth';
import { AutomationBuilder } from '@/components/automations/automation-builder';

export default function NewAutomationPage() {
  const { workspaceId } = useAuth();
  if (!workspaceId) return null;
  return <AutomationBuilder workspaceId={workspaceId} />;
}
