import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, X, Send, Loader2, ChevronLeft, Clock,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/StatusPill';
import { DeleteEntityMenu } from '@/components/DeleteEntityMenu';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMsg = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  sent_at: string;
  expires_at: string;
};

type StaffMember = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  suffix: string | null;
  username: string | null;
  designation: string | null;
  plant_assignments: string[];
  status: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeUntilExpiry(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Chat Window
// ---------------------------------------------------------------------------

function ChatWindow({
  peer,
  currentUserId,
  onClose,
}: {
  peer: StaffMember;
  currentUserId: string;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], refetch } = useQuery<ChatMsg[]>({
    queryKey: ['chat', currentUserId, peer.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .or(
          `and(sender_id.eq.${currentUserId},recipient_id.eq.${peer.id}),` +
          `and(sender_id.eq.${peer.id},recipient_id.eq.${currentUserId})`
        )
        .gt('expires_at', new Date().toISOString())
        .order('sent_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChatMsg[];
    },
    refetchInterval: 5000,
  });

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`chat:${[currentUserId, peer.id].sort().join('-')}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        () => refetch(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUserId, peer.id, refetch]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = useCallback(async () => {
    const body = input.trim();
    if (!body) return;
    setInput('');
    setSending(true);
    try {
      await supabase.from('chat_messages').insert({
        sender_id: currentUserId,
        recipient_id: peer.id,
        body,
      });
      refetch();
    } finally {
      setSending(false);
    }
  }, [input, currentUserId, peer.id, refetch]);

  const peerName = [peer.first_name, peer.last_name, peer.suffix].filter(Boolean).join(' ') || peer.username || 'Unknown';

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 shadow-2xl rounded-xl overflow-hidden border border-border bg-background flex flex-col"
         style={{ height: 420 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-sky-600 to-teal-600 text-white shrink-0">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{peerName}</div>
          <div className="text-[10px] opacity-80 truncate">@{peer.username ?? '—'} · {peer.designation ?? '—'}</div>
        </div>
        <div className={cn(
          'h-2 w-2 rounded-full shrink-0',
          peer.status === 'Active' ? 'bg-emerald-300' : 'bg-zinc-400',
        )} />
        <Button size="icon" variant="ghost" className="h-6 w-6 text-white hover:bg-white/20" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Ephemeral notice */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-b border-amber-100 text-amber-700 text-[10px] shrink-0">
        <Clock className="h-3 w-3 shrink-0" />
        Messages auto-delete after 8 hours. No content is retained.
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground text-center px-4">
            No messages yet. Say hello!
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === currentUserId;
            return (
              <div key={m.id} className={cn('flex flex-col gap-0.5', mine ? 'items-end' : 'items-start')}>
                <div className={cn(
                  'rounded-lg px-2.5 py-1.5 text-xs max-w-[85%] break-words',
                  mine
                    ? 'bg-sky-600 text-white rounded-br-sm'
                    : 'bg-muted text-foreground rounded-bl-sm',
                )}>
                  {m.body}
                </div>
                <div className="flex items-center gap-1 text-[9px] text-muted-foreground px-0.5">
                  <span>{formatTime(m.sent_at)}</span>
                  <span>·</span>
                  <Clock className="h-2.5 w-2.5" />
                  <span>{timeUntilExpiry(m.expires_at)}</span>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t p-2 flex gap-1.5 shrink-0">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type a message…"
          className="flex-1 h-8 text-xs"
          disabled={sending}
          autoFocus
        />
        <Button size="sm" className="h-8 px-2" onClick={send} disabled={sending || !input.trim()}>
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff tab (with Chat buttons)
// ---------------------------------------------------------------------------

function Staff() {
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();

  const [chatPeer, setChatPeer] = useState<StaffMember | null>(null);

  const { data: staff } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: async () => (await supabase.from('user_profiles').select('*').order('last_name')).data ?? [],
  });

  const { data: roles } = useQuery({
    queryKey: ['all-roles'],
    queryFn: async () => (await supabase.from('user_roles').select('*')).data ?? [],
  });

  const filtered = selectedPlantId
    ? staff?.filter((s) => s.plant_assignments?.includes(selectedPlantId))
    : staff;

  const roleOf = (uid: string) =>
    (roles as any[])?.filter((r) => r.user_id === uid).map((r) => r.role).join(', ') || '—';

  const plantNames = (ids: string[]) =>
    plants?.filter((p) => ids?.includes(p.id)).map((p) => p.name).join(', ') || '—';

  const setRole = async (uid: string, role: string) => {
    if (!isAdmin) return;
    await supabase.from('user_roles').delete().eq('user_id', uid);
    await supabase.from('user_roles').insert({ user_id: uid, role: role as any });
    qc.invalidateQueries({ queryKey: ['all-roles'] });
  };

  return (
    <>
      <div className="space-y-2">
        {filtered?.map((s) => {
          const isSelf = s.id === user?.id;
          return (
            <Card key={s.id} className="p-3">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium text-sm">
                    {s.first_name} {s.last_name} {s.suffix}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.designation ?? '—'} · @{s.username ?? '—'}
                  </div>
                  <div className="text-xs mt-1">
                    Plants: <span className="text-muted-foreground">{plantNames(s.plant_assignments)}</span>
                  </div>
                  <div className="text-xs">
                    Role: <span className="font-medium">{roleOf(s.id)}</span>
                  </div>
                </div>
                <div className="flex items-start gap-2 flex-wrap justify-end">
                  <StatusPill tone={s.status === 'Active' ? 'accent' : s.status === 'Pending' ? 'warn' : 'muted'}>
                    {s.status}
                  </StatusPill>
                  {/* Chat button — visible to all roles, hidden for self */}
                  {!isSelf && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => setChatPeer((prev) => (prev?.id === s.id ? null : s))}
                    >
                      <MessageSquare className="h-3 w-3" />
                      Chat
                    </Button>
                  )}
                  {isAdmin && (
                    <DeleteEntityMenu
                      kind="user"
                      id={s.id}
                      label={`${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || (s.username ?? 'user')}
                      canSoftDelete={s.status === 'Active'}
                      canHardDelete
                      invalidateKeys={[['staff'], ['all-roles']]}
                      compact
                    />
                  )}
                </div>
              </div>
              {isAdmin && (
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {(['Operator', 'Technician', 'Manager', 'Admin'] as const).map((r) => (
                    <Button key={r} size="sm" variant="outline" onClick={() => setRole(s.id, r)}>
                      {r}
                    </Button>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
        {!filtered?.length && (
          <Card className="p-4 text-xs text-center text-muted-foreground">No staff</Card>
        )}
      </div>

      {/* Floating chat window */}
      {chatPeer && user && (
        <ChatWindow
          peer={chatPeer}
          currentUserId={user.id}
          onClose={() => setChatPeer(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Register Info tab
// ---------------------------------------------------------------------------

function RegisterInfo() {
  return (
    <Card className="p-4 text-sm space-y-2">
      <h3 className="font-semibold">How to register new staff</h3>
      <p className="text-muted-foreground">
        New users sign up themselves on the login page using their email + password. After confirming,
        they will be guided through a profile setup flow where they select their plants, designation, etc.
      </p>
      <p className="text-muted-foreground">
        An <strong>Admin</strong> must then set their role from the Staff tab. New users default to{' '}
        <strong>Operator</strong>.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Employees() {
  return (
    <div className="space-y-3 animate-fade-in">
      <h1 className="text-xl font-semibold tracking-tight">Employees</h1>
      <Tabs defaultValue="staff">
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="info">Info</TabsTrigger>
        </TabsList>
        <TabsContent value="staff" className="mt-3"><Staff /></TabsContent>
        <TabsContent value="info" className="mt-3"><RegisterInfo /></TabsContent>
      </Tabs>
    </div>
  );
}
