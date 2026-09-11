'use client';

import { use, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { AutomationBuilder, type AutomationInitial } from '@/components/automations/automation-builder';

export default function EditAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { workspaceId } = useAuth();
  const [initial, setInitial] = useState<AutomationInitial | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    fetch(`/api/account/automations/${id}?workspace_id=${workspaceId}`)
      .then((r) => r.json())
      .then((json) => setInitial(json.data));
  }, [workspaceId, id]);

  if (!workspaceId || !initial) return null;
  return <AutomationBuilder workspaceId={workspaceId} automationId={id} initial={initial} />;
}
