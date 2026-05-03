import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  MessageSquare, X, Send, Loader2, Clock,
  Building2, User, ShieldCheck, MapPin, ChevronRight,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  middle_name: string | null;
  suffix: string | null;
  username: string | null;
  designation: string | null;
  plant_assignments: string[];
  status: string;
  updated_at: string;
  immediate_head_id: string | null;
};

// ---------------------------------------------------------------------------
// Presence helpers (uses updated_at as activity proxy)
// ---------------------------------------------------------------------------

type PresenceState = 'active' | 'idle' | 'away' | 'offline';

function getPresence(updatedAt: string, accountStatus: string): PresenceState {
  if (accountStatus === 'Suspended' || accountStatus === 'Pending') return 'offline';
  const diffMin = (Date.now() - new Date(updatedAt).getTime()) / 60_000;
  if (diffMin < 15)  return 'active';
  if (diffMin < 60)  return 'idle';
  if (diffMin < 480) return 'away';
  return 'offline';
}

const presenceConfig: Record<PresenceState, { label: string; dot: string; badge: string }> = {
  active:  { label: 'Active',  dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  idle:    { label: 'Idle',    dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  away:    { label: 'Away',    dot: 'bg-orange-400',  badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  offline: { label: 'Offline', dot: 'bg-zinc-300',    badge: 'bg-zinc-50 text-zinc-500 border-zinc-200' },
};

// ---------------------------------------------------------------------------
// Per-user deterministic colour accent
// ---------------------------------------------------------------------------

const TILE_ACCENTS = [
  'border-l-sky-400', 'border-l-violet-400', 'border-l-teal-400', 'border-l-rose-400',
  'border-l-amber-400', 'border-l-indigo-400', 'border-l-emerald-400', 'border-l-pink-400',
];

const AVATAR_COLORS = [
  'bg-sky-500', 'bg-violet-500', 'bg-teal-500', 'bg-rose-500',
  'bg-amber-500', 'bg-indigo-500', 'bg-emerald-500', 'bg-pink-500',
];

function hashId(id: string) {
  return id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
}

function accentForId(id: string)  { return TILE_ACCENTS[hashId(id) % TILE_ACCENTS.length]; }
function avatarColor(id: string)  { return AVATAR_COLORS[hashId(id) % AVATAR_COLORS.length]; }

function initials(s: StaffMember) {
  const f = s.first_name?.[0] ?? '';
  const l = s.last_name?.[0] ?? '';
  return (f + l).toUpperCase() || (s.username?.[0] ?? '?').toUpperCase();
}

function fullName(s: StaffMember) {
  return [s.first_name, s.middle_name ? s.middle_name[0] + '.' : null, s.last_name, s.suffix]
    .filter(Boolean).join(' ') || s.username || 'Unknown';
}

// ---------------------------------------------------------------------------
// Chat helpers
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

function ChatWindow({ peer, currentUserId, onClose }: {
  peer: StaffMember; currentUserId: string; onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], refetch } = useQuery<ChatMsg[]>({
    queryKey: ['chat', currentUserId, peer.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('chat_messages').select('*')
        .or(`and(sender_id.eq.${currentUserId},recipient_id.eq.${peer.id}),and(sender_id.eq.${peer.id},recipient_id.eq.${currentUserId})`)
        .gt('expires_at', new Date().toISOString())
        .order('sent_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChatMsg[];
    },
    refetchInterval: 5000,
  });

  useEffect(() => {
    const ch = supabase.channel(`chat:${[currentUserId, peer.id].sort().join('-')}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [currentUserId, peer.id, refetch]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const send = useCallback(async () => {
    const body = input.trim();
    if (!body) return;
    setInput(''); setSending(true);
    try {
      await (supabase as any).from('chat_messages').insert({ sender_id: currentUserId, recipient_id: peer.id, body });
      refetch();
    } finally { setSending(false); }
  }, [input, currentUserId, peer.id, refetch]);

  const presence = getPresence(peer.updated_at, peer.status);
  const pc = presenceConfig[presence];

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 shadow-2xl rounded-xl overflow-hidden border border-border bg-background flex flex-col" style={{ height: 420 }}>
      <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-sky-600 to-teal-600 text-white shrink-0">
        <div className={cn('h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0', avatarColor(peer.id))}>
          {initials(peer)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{fullName(peer)}</div>
          <div className="flex items-center gap-1 text-[10px] opacity-80">
            <span className={cn('h-1.5 w-1.5 rounded-full', pc.dot)} />
            {pc.label} · @{peer.username ?? '—'}
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6 text-white hover:bg-white/20" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-b border-amber-100 text-amber-700 text-[10px] shrink-0">
        <Clock className="h-3 w-3 shrink-0" />
        Messages auto-delete after 8 hours. No content is retained.
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0
          ? <div className="h-full flex items-center justify-center text-xs text-muted-foreground text-center px-4">No messages yet. Say hello!</div>
          : messages.map((m) => {
              const mine = m.sender_id === currentUserId;
              return (
                <div key={m.id} className={cn('flex flex-col gap-0.5', mine ? 'items-end' : 'items-start')}>
                  <div className={cn('rounded-lg px-2.5 py-1.5 text-xs max-w-[85%] break-words',
                    mine ? 'bg-sky-600 text-white rounded-br-sm' : 'bg-muted text-foreground rounded-bl-sm')}>
                    {m.body}
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-muted-foreground px-0.5">
                    <span>{formatTime(m.sent_at)}</span><span>·</span>
                    <Clock className="h-2.5 w-2.5" /><span>{timeUntilExpiry(m.expires_at)}</span>
                  </div>
                </div>
              );
            })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-2 flex gap-1.5 shrink-0">
        <Input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type a message…" className="flex-1 h-8 text-xs" disabled={sending} autoFocus />
        <Button size="sm" className="h-8 px-2" onClick={send} disabled={sending || !input.trim()}>
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InfoRow helper
// ---------------------------------------------------------------------------

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-2.5">
      <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className="text-sm break-words">{value}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Drawer
// ---------------------------------------------------------------------------

function DetailDrawer({ member, roles, plants, allStaff, onChat, onClose, isSelf, isAdmin }: {
  member: StaffMember; roles: any[]; plants: any[]; allStaff: StaffMember[];
  onChat: () => void; onClose: () => void; isSelf: boolean; isAdmin: boolean;
}) {
  const presence = getPresence(member.updated_at, member.status);
  const pc = presenceConfig[presence];
  const memberRoles = roles.filter((r) => r.user_id === member.id).map((r) => r.role);
  const memberPlants = plants.filter((p) => member.plant_assignments?.includes(p.id)).map((p) => p.name);
  const head = allStaff.find((s) => s.id === member.immediate_head_id);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-80 bg-background border-l shadow-2xl flex flex-col">
        <div className={cn('h-1.5 w-full', avatarColor(member.id))} />
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold">Employee Details</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col items-center pt-6 pb-4 px-4 text-center">
            <div className={cn('h-16 w-16 rounded-full flex items-center justify-center text-xl font-bold text-white mb-3', avatarColor(member.id))}>
              {initials(member)}
            </div>
            <div className="font-semibold text-base">{fullName(member)}</div>
            <div className="text-xs text-muted-foreground mt-0.5">@{member.username ?? '—'}</div>
            <div className={cn('flex items-center gap-1.5 mt-2 text-xs px-2.5 py-1 rounded-full border font-medium', pc.badge)}>
              <span className={cn('h-2 w-2 rounded-full', pc.dot)} />
              {pc.label}
            </div>
          </div>

          <div className="px-4 space-y-3 pb-6">
            <InfoRow icon={<User className="h-3.5 w-3.5" />}       label="Designation"  value={member.designation ?? '—'} />
            <InfoRow icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Role(s)"      value={memberRoles.join(', ') || '—'} />
            <InfoRow icon={<Building2 className="h-3.5 w-3.5" />}  label="Plants"       value={memberPlants.join(', ') || '—'} />
            <InfoRow icon={<MapPin className="h-3.5 w-3.5" />}     label="Reports to"   value={head ? fullName(head) : '—'} />
            <InfoRow icon={<Clock className="h-3.5 w-3.5" />}      label="Account status" value={member.status} />
          </div>
        </div>

        <div className="border-t p-4 flex gap-2">
          {!isSelf && (
            <Button className="flex-1 gap-1.5" size="sm" onClick={() => { onChat(); onClose(); }}>
              <MessageSquare className="h-3.5 w-3.5" /> Chat
            </Button>
          )}
          {isAdmin && (
            <DeleteEntityMenu
              kind="user" id={member.id} label={fullName(member)}
              canSoftDelete={member.status === 'Active'} canHardDelete
              invalidateKeys={[['staff'], ['all-roles']]} compact
            />
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Staff Tile
// ---------------------------------------------------------------------------

function StaffTile({ member, roles, isSelf, onChat, onDetail }: {
  member: StaffMember; roles: any[]; isSelf: boolean; onChat: () => void; onDetail: () => void;
}) {
  const presence = getPresence(member.updated_at, member.status);
  const pc = presenceConfig[presence];
  const memberRole = (roles as any[]).find((r) => r.user_id === member.id)?.role ?? '—';

  return (
    <div
      className={cn(
        'relative bg-card rounded-lg border border-l-4 p-3 flex flex-col gap-2',
        'hover:shadow-md transition-shadow cursor-pointer group',
        accentForId(member.id),
      )}
      onClick={onDetail}
    >
      <div className="flex items-start gap-2.5">
        <div className="relative shrink-0">
          <div className={cn('h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold text-white', avatarColor(member.id))}>
            {initials(member)}
          </div>
          <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background', pc.dot)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm leading-tight truncate">
            {fullName(member)}
            {isSelf && <span className="ml-1 text-[10px] text-muted-foreground">(you)</span>}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">{member.designation ?? '—'}</div>
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium">{memberRole}</span>
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded border font-medium', pc.badge)}>{pc.label}</span>
        <div className="flex-1" />
        {!isSelf && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] gap-1 hover:bg-sky-50 hover:text-sky-700"
            onClick={(e) => { e.stopPropagation(); onChat(); }}>
            <MessageSquare className="h-3 w-3" /> Chat
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff tab
// ---------------------------------------------------------------------------

function Staff() {
  const { data: plants } = usePlants();
  const { isAdmin, user } = useAuth();

  const [chatPeer, setChatPeer] = useState<StaffMember | null>(null);
  const [detailMember, setDetailMember] = useState<StaffMember | null>(null);

  // Fetch ALL profiles — no plant filter so every registered user shows up
  const { data: staff = [] } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('*').order('last_name');
      if (error) throw error;
      return (data ?? []) as StaffMember[];
    },
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['all-roles'],
    queryFn: async () => (await supabase.from('user_roles').select('*')).data ?? [],
  });

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {staff.map((s) => (
          <StaffTile key={s.id} member={s} roles={roles as any[]}
            isSelf={s.id === user?.id}
            onChat={() => setChatPeer(s)}
            onDetail={() => setDetailMember(s)}
          />
        ))}
        {staff.length === 0 && (
          <div className="col-span-full">
            <Card className="p-6 text-xs text-center text-muted-foreground">No staff found</Card>
          </div>
        )}
      </div>

      {detailMember && (
        <DetailDrawer
          member={detailMember} roles={roles as any[]} plants={plants ?? []} allStaff={staff}
          isSelf={detailMember.id === user?.id} isAdmin={isAdmin}
          onChat={() => setChatPeer(detailMember)}
          onClose={() => setDetailMember(null)}
        />
      )}

      {chatPeer && user && (
        <ChatWindow peer={chatPeer} currentUserId={user.id} onClose={() => setChatPeer(null)} />
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
