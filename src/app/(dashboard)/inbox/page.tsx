'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FileText, Send } from 'lucide-react';

interface ConversationSummary {
  id: string;
  contact: { id: string; name: string | null; phone: string };
  last_message_text: string | null;
  last_message_at: string | null;
  unread_count: number;
}

interface Message {
  id: string;
  sender_type: string;
  content_type: string;
  content_text: string | null;
  media_url: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface Contact {
  id: string;
  name: string | null;
  phone: string;
}

const POLL_INTERVAL_MS = 3000;

function renderMessageContent(m: Message, onMediaLoad: () => void) {
  if (m.media_url && m.content_type === 'image') {
    return (
      <div className="flex flex-col gap-1">
        <img
          src={m.media_url}
          alt={m.content_text ?? 'Image'}
          onLoad={onMediaLoad}
          className="max-h-80 max-w-full rounded-xl object-cover"
        />
        {m.content_text && <span className="px-2 pb-1">{m.content_text}</span>}
      </div>
    );
  }
  if (m.media_url && m.content_type === 'video') {
    return (
      <div className="flex flex-col gap-1">
        <video
          controls
          src={m.media_url}
          onLoadedMetadata={onMediaLoad}
          className="max-h-80 max-w-full rounded-xl"
        />
        {m.content_text && <span className="px-2 pb-1">{m.content_text}</span>}
      </div>
    );
  }
  if (m.media_url && m.content_type === 'audio') {
    return <audio controls src={m.media_url} className="max-w-full" />;
  }
  if (m.media_url && m.content_type === 'document') {
    return (
      <a
        href={m.media_url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 underline underline-offset-2"
      >
        <FileText className="size-4 shrink-0" />
        {m.content_text ?? 'Document'}
      </a>
    );
  }
  return m.content_text ?? `[${m.content_type}]`;
}

export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxPageInner />
    </Suspense>
  );
}

function InboxPageInner() {
  const { workspaceId, canSendMessages } = useAuth();
  const searchParams = useSearchParams();
  const startContactId = searchParams.get('contact');

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingContact, setPendingContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // Whether the view should stay pinned to the latest message. Starts
  // true (fresh open), flips to false once the user scrolls away from
  // the bottom to read history, flips back once they scroll down again.
  const stickToBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

  const loadConversations = useCallback(async () => {
    if (!workspaceId) return;
    const res = await fetch(`/api/account/conversations?workspace_id=${workspaceId}`);
    if (res.ok) {
      const json = await res.json();
      setConversations(json.data);
    }
    setLoadingConversations(false);
  }, [workspaceId]);

  useEffect(() => {
    // Mount + refetch-on-dependency-change data fetch, not a derived-
    // state-from-props case — the rule below is tuned for the latter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations();
    const interval = setInterval(loadConversations, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadConversations]);

  // Deep-link from the Contacts page (?contact=<id>) — select the
  // existing conversation if one exists, otherwise stage a "new
  // conversation" composer that sends by phone on first message.
  useEffect(() => {
    if (!startContactId || loadingConversations || !workspaceId) return;
    const existing = conversations.find((c) => c.contact.id === startContactId);
    if (existing) {
      // Deriving selection from a query param + already-fetched data,
      // not deriving render state from props — the rule below is
      // tuned for the latter.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(existing.id);
      return;
    }
    fetch(`/api/account/contacts?workspace_id=${workspaceId}`)
      .then((res) => res.json())
      .then((json) => {
        const contact = (json.data as Contact[]).find((c) => c.id === startContactId);
        if (contact) setPendingContact(contact);
      });
  }, [startContactId, loadingConversations, conversations, workspaceId]);

  const loadMessages = useCallback(
    async (conversationId: string, opts?: { silent?: boolean }) => {
      if (!workspaceId) return;
      if (!opts?.silent) setLoadingMessages(true);
      const res = await fetch(
        `/api/account/conversations/${conversationId}/messages?workspace_id=${workspaceId}`
      );
      if (res.ok) {
        const json = await res.json();
        setMessages(json.data);
      }
      if (!opts?.silent) setLoadingMessages(false);
    },
    [workspaceId]
  );

  useEffect(() => {
    if (selectedId) {
      // Refetch-on-selection-change data fetch, not derived-state-
      // from-props — the rule below is tuned for the latter.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingContact(null);
      // Optimistic — the messages GET call below clears unread_count
      // server-side too, but that only lands on the next conversations
      // poll (up to POLL_INTERVAL_MS away). Clear the badge locally now
      // so it doesn't linger for a few seconds after opening the thread.
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedId ? { ...c, unread_count: 0 } : c))
      );
      // A newly-opened conversation should jump to its latest message.
      stickToBottomRef.current = true;
      loadMessages(selectedId);
      const interval = setInterval(
        () => loadMessages(selectedId, { silent: true }),
        POLL_INTERVAL_MS
      );
      return () => clearInterval(interval);
    } else {
      setMessages([]);
    }
  }, [selectedId, loadMessages]);

  useEffect(() => {
    // Re-snap to bottom whenever the message list changes, but only
    // while the view is already pinned there (fresh open, or already
    // caught up) — never yanks a user who scrolled up to read history.
    if (stickToBottomRef.current) {
      // Next frame, so the DOM has the new message nodes before we
      // measure scrollHeight.
      requestAnimationFrame(scrollToBottom);
    }
  }, [messages, scrollToBottom]);

  const handleSend = async () => {
    if (!workspaceId || !text.trim()) return;
    setSending(true);
    setError(null);

    const body: Record<string, string> = { workspace_id: workspaceId, text: text.trim() };
    if (selectedId) {
      body.conversation_id = selectedId;
    } else if (pendingContact) {
      body.to = pendingContact.phone;
      if (pendingContact.name) body.name = pendingContact.name;
    } else {
      setSending(false);
      return;
    }

    const res = await fetch('/api/account/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setSending(false);

    if (!res.ok) {
      setError(json.error ?? 'Something went wrong');
      return;
    }

    setText('');
    if (json.data?.conversation_id) {
      setSelectedId(json.data.conversation_id);
    }
    loadConversations();
    if (json.data?.conversation_id) loadMessages(json.data.conversation_id);
  };

  const selectedConversation = conversations.find((c) => c.id === selectedId);
  const headerContact = selectedConversation?.contact ?? pendingContact;

  return (
    <div className="flex h-full">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-border">
        {loadingConversations ? (
          <p className="p-4 text-sm text-muted-foreground">Loading conversations...</p>
        ) : conversations.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No conversations yet — messages appear here once you send or receive one.
          </p>
        ) : (
          <ul>
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted',
                    selectedId === c.id && 'bg-muted'
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {c.contact.name ?? c.contact.phone}
                    </span>
                    {c.unread_count > 0 && (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
                        {c.unread_count > 99 ? '99+' : c.unread_count}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {c.last_message_text ?? 'No messages yet'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!headerContact ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation, or message a contact from the Contacts page.
          </div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-medium text-foreground">
                {headerContact.name ?? headerContact.phone}
              </p>
              {headerContact.name && (
                <p className="text-xs text-muted-foreground">{headerContact.phone}</p>
              )}
            </div>

            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className="flex-1 overflow-y-auto p-4"
            >
              {loadingMessages ? (
                <p className="text-sm text-muted-foreground">Loading messages...</p>
              ) : messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No messages yet — say hello below.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        'flex flex-col gap-0.5',
                        m.sender_type === 'agent' ? 'items-end' : 'items-start'
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-md rounded-2xl text-sm',
                          m.media_url && ['image', 'video'].includes(m.content_type)
                            ? 'overflow-hidden p-1'
                            : 'px-4 py-2',
                          m.sender_type === 'agent'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-foreground'
                        )}
                      >
                        {renderMessageContent(m, () => {
                          if (stickToBottomRef.current) scrollToBottom();
                        })}
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(m.created_at).toLocaleString()} · {m.status}
                      </span>
                      {m.status === 'failed' && m.error_message && (
                        <span className="max-w-md text-[10px] text-destructive">{m.error_message}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {canSendMessages ? (
              <div className="flex items-end gap-2 border-t border-border p-3">
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Type a message..."
                  className="min-h-10 flex-1 resize-none"
                />
                <Button onClick={handleSend} disabled={sending || !text.trim()} size="icon">
                  <Send className="size-4" />
                </Button>
              </div>
            ) : (
              <p className="border-t border-border p-3 text-center text-xs text-muted-foreground">
                Viewers can&apos;t send messages.
              </p>
            )}
            {error && (
              <div className="border-t border-border px-3 py-2 text-center text-xs text-red-400">
                {error}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
