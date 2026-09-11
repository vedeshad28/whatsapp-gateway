'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { WhatsappConfigSettings } from '@/components/settings/whatsapp-config';

const TABS = ['profile', 'whatsapp', 'members', 'api-keys'] as const;
type SettingsTab = (typeof TABS)[number];

function isSettingsTab(value: string | null): value is SettingsTab {
  return !!value && (TABS as readonly string[]).includes(value);
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = isSettingsTab(searchParams.get('tab')) ? searchParams.get('tab')! : 'profile';

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h2 className="mb-6 text-lg font-semibold text-foreground">Settings</h2>
      <Tabs value={tab} onValueChange={(v) => router.push(`/settings?tab=${v}`)}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="api-keys">API keys</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="whatsapp">
          <WhatsappConfigSettings />
        </TabsContent>
        <TabsContent value="members">
          <MembersTab />
        </TabsContent>
        <TabsContent value="api-keys">
          <ApiKeysSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileTab() {
  const { user, workspace } = useAuth();
  const [name, setName] = useState(user?.name ?? '');

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-email">Email</Label>
        <Input id="profile-email" value={user?.email ?? ''} disabled />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-name">Name</Label>
        <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="profile-workspace">Workspace</Label>
        <Input id="profile-workspace" value={workspace?.name ?? ''} disabled />
      </div>
      <p className="text-xs text-muted-foreground">
        Saving profile changes and workspace renaming land in a later phase of the CRM
        restoration — this tab is read-only for now.
      </p>
    </div>
  );
}
