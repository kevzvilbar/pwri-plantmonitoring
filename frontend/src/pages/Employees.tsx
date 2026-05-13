import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTabPersist } from '@/hooks/useTabPersist';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, X, Send, Loader2, Clock,
  Building2, User, ShieldCheck, MapPin, ChevronRight,
  Users, CheckCircle2, AlertCircle, BookOpen, ChevronDown,
  GitBranch, ClipboardList, Check, CheckCheck, ChevronsDownUp, ChevronsUpDown,
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
// Presence helpers
// ---------------------------------------------------------------------------

type PresenceState = 'active' | 'idle' | 'away' | 'offline';

function getPresence(updatedAt: string, accountStatus: string, isOnline = false): PresenceState {
  if (accountStatus === 'Suspended' || accountStatus === 'Pending') return 'offline';
  if (isOnline) return 'active';
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

// Per-plant column accent colours for the reporting tree
const PLANT_COLUMN_ACCENTS = [
  { header: 'from-sky-500 to-cyan-500',     border: 'border-sky-200',    bg: 'bg-sky-50/60',    text: 'text-sky-700'    },
  { header: 'from-violet-500 to-indigo-500', border: 'border-violet-200', bg: 'bg-violet-50/60', text: 'text-violet-700' },
  { header: 'from-teal-500 to-emerald-500',  border: 'border-teal-200',   bg: 'bg-teal-50/60',   text: 'text-teal-700'   },
  { header: 'from-rose-500 to-pink-500',     border: 'border-rose-200',   bg: 'bg-rose-50/60',   text: 'text-rose-700'   },
  { header: 'from-amber-500 to-orange-500',  border: 'border-amber-200',  bg: 'bg-amber-50/60',  text: 'text-amber-700'  },
  { header: 'from-indigo-500 to-blue-500',   border: 'border-indigo-200', bg: 'bg-indigo-50/60', text: 'text-indigo-700' },
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

function timeUntilExpiry(expiresAt: string | null | undefined) {
  if (!expiresAt) return '—';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Animated typing indicator — three bouncing dots
function TypingIndicator() {
  return (
    <div className="flex items-center gap-0.5 px-3 py-2 bg-muted rounded-lg rounded-bl-sm w-fit">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
          style={{ animationDelay: `${i * 150}ms`, animationDuration: '900ms' }}
        />
      ))}
    </div>
  );
}

// Message status tick (sent = single check, delivered/read = double check)
function MsgStatus({ isMine, msgId, messages }: { isMine: boolean; msgId: string; messages: ChatMsg[] }) {
  if (!isMine) return null;
  // If a later message exists it means DB confirmed — show delivered (double tick)
  const idx = messages.findIndex((m) => m.id === msgId);
  const delivered = idx !== -1;
  return delivered
    ? <CheckCheck className="h-2.5 w-2.5 text-sky-300 shrink-0" />
    : <Check className="h-2.5 w-2.5 text-white/50 shrink-0" />;
}

// ---------------------------------------------------------------------------
// Chat Window — improved with typing indicator, message status, mobile-safe
// ---------------------------------------------------------------------------

function ChatWindow({ peer, currentUserId, onClose, onlineIds }: {
  peer: StaffMember; currentUserId: string; onClose: () => void; onlineIds: Set<string>;
}) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // peerTyping: whether the peer is currently typing (via broadcast)
  const [peerTyping, setPeerTyping] = useState(false);
  const peerTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track locally-inserted optimistic IDs so we can show a sending state
  const [optimisticIds] = useState(() => new Set<string>());
  const bottomRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Track whether we've typed since last broadcast to debounce
  const typingBroadcastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMessages = useCallback(async (): Promise<ChatMsg[]> => {
    const { data, error } = await (supabase as any)
      .from('chat_messages').select('*')
      .or(`and(sender_id.eq.${currentUserId},recipient_id.eq.${peer.id}),and(sender_id.eq.${peer.id},recipient_id.eq.${currentUserId})`)
      .gt('expires_at', new Date().toISOString())
      .order('sent_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ChatMsg[];
  }, [currentUserId, peer.id]);

  const { data: messages = [], refetch } = useQuery<ChatMsg[]>({
    queryKey: ['chat', currentUserId, peer.id],
    queryFn: fetchMessages,
  });

  useEffect(() => {
    const channelName = `chat:${[currentUserId, peer.id].sort().join(':')}`;
    const ch = supabase
      .channel(channelName)
      .on('broadcast', { event: 'new_message' }, () => refetch())
      .on('broadcast', { event: 'typing' }, ({ payload }: any) => {
        // Only show indicator if the peer is the one typing
        if (payload?.sender_id && payload.sender_id !== currentUserId) {
          setPeerTyping(true);
          // Auto-clear if no further typing event within 3 s
          if (peerTypingTimer.current) clearTimeout(peerTypingTimer.current);
          peerTypingTimer.current = setTimeout(() => setPeerTyping(false), 3000);
        }
      })
      .subscribe();
    channelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      channelRef.current = null;
      if (peerTypingTimer.current) clearTimeout(peerTypingTimer.current);
      if (typingBroadcastTimer.current) clearTimeout(typingBroadcastTimer.current);
    };
  }, [currentUserId, peer.id, refetch]);

  // Scroll on new messages or typing indicator toggle
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, peerTyping]);

  // Broadcast a typing event (debounced, max once per 1.5 s)
  const broadcastTyping = useCallback(() => {
    if (typingBroadcastTimer.current) return; // already debouncing
    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { sender_id: currentUserId } });
    }
    typingBroadcastTimer.current = setTimeout(() => {
      typingBroadcastTimer.current = null;
    }, 1500);
  }, [currentUserId]);

  const send = useCallback(async () => {
    const body = input.trim();
    if (!body) return;
    setInput('');
    setSending(true);
    try {
      await (supabase as any).from('chat_messages').insert({ sender_id: currentUserId, recipient_id: peer.id, body });
      if (channelRef.current) {
        await channelRef.current.send({ type: 'broadcast', event: 'new_message', payload: {} });
      } else {
        refetch();
      }
    } finally { setSending(false); }
  }, [input, currentUserId, peer.id, refetch]);

  const presence = getPresence(peer.updated_at, peer.status, onlineIds.has(peer.id));
  const pc = presenceConfig[presence];

  // Mobile-safe positioning: bottom-right on desktop, bottom-0 full-width on very small screens
  return (
    <div
      className={cn(
        'fixed z-50 bg-background border border-border shadow-2xl flex flex-col overflow-hidden',
        // Mobile: full-width at bottom
        'bottom-0 left-0 right-0 rounded-t-xl',
        // md+: floating window bottom-right
        'md:bottom-4 md:left-auto md:right-4 md:rounded-xl md:w-80',
      )}
      style={{ height: 'min(460px, 80dvh)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gradient-to-r from-sky-600 to-teal-600 text-white shrink-0">
        <div className="relative shrink-0">
          <div className={cn('h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold', avatarColor(peer.id))}>
            {initials(peer)}
          </div>
          <span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-sky-600', pc.dot)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate leading-tight">{fullName(peer)}</div>
          <div className="text-[10px] opacity-75 leading-tight">
            {peerTyping ? (
              <span className="animate-pulse">typing…</span>
            ) : (
              <span>{pc.label} · @{peer.username ?? '—'}</span>
            )}
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6 text-white hover:bg-white/20 shrink-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Ephemeral notice */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-b border-amber-100 text-amber-700 text-[10px] shrink-0">
        <Clock className="h-3 w-3 shrink-0" />
        Messages auto-delete after 8 hours. No content is retained.
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.length === 0 && !peerTyping ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground text-center px-6">
            No messages yet. Say hello!
          </div>
        ) : (
          <>
            {messages.map((m) => {
              const mine = m.sender_id === currentUserId;
              return (
                <div key={m.id} className={cn('flex flex-col gap-0.5', mine ? 'items-end' : 'items-start')}>
                  <div className={cn(
                    'rounded-2xl px-3 py-2 text-xs max-w-[85%] break-words leading-relaxed',
                    mine
                      ? 'bg-sky-600 text-white rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm',
                  )}>
                    {m.body}
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-muted-foreground px-1">
                    <span>{formatTime(m.sent_at)}</span>
                    <span className="opacity-40">·</span>
                    <Clock className="h-2 w-2 opacity-60" />
                    <span>{timeUntilExpiry(m.expires_at)}</span>
                    <MsgStatus isMine={mine} msgId={m.id} messages={messages} />
                  </div>
                </div>
              );
            })}

            {/* Typing indicator bubble */}
            {peerTyping && (
              <div className="flex items-start">
                <div className="flex flex-col gap-0.5 items-start">
                  <TypingIndicator />
                  <span className="text-[9px] text-muted-foreground px-1">{peer.first_name ?? peer.username} is typing…</span>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t p-2 flex gap-1.5 shrink-0 bg-background">
        <Input
          value={input}
          onChange={(e) => { setInput(e.target.value); broadcastTyping(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type a message…"
          className="flex-1 h-9 text-xs rounded-full px-4"
          disabled={sending}
          autoFocus
        />
        <Button
          size="sm"
          className="h-9 w-9 p-0 rounded-full shrink-0"
          onClick={send}
          disabled={sending || !input.trim()}
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InfoRow helper
// ---------------------------------------------------------------------------

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
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

function DetailDrawer({ member, roles, plants, allStaff, onChat, onClose, isSelf, isAdmin, onlineIds }: {
  member: StaffMember; roles: any[]; plants: any[]; allStaff: StaffMember[];
  onChat: () => void; onClose: () => void; isSelf: boolean; isAdmin: boolean; onlineIds: Set<string>;
}) {
  const presence = getPresence(member.updated_at, member.status, onlineIds.has(member.id));
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
            <InfoRow icon={<User className="h-3.5 w-3.5" />}       label="Designation"    value={member.designation ?? '—'} />
            <InfoRow icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Role(s)"        value={memberRoles.join(', ') || '—'} />
            <InfoRow icon={<Building2 className="h-3.5 w-3.5" />}  label="Plants"         value={memberPlants.join(', ') || '—'} />
            <InfoRow icon={<MapPin className="h-3.5 w-3.5" />}     label="Reports to"     value={head ? fullName(head) : '—'} />
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

function StaffTile({ member, roles, isSelf, onlineIds, onChat, onDetail }: {
  member: StaffMember; roles: any[]; isSelf: boolean; onlineIds: Set<string>; onChat: () => void; onDetail: () => void;
}) {
  const presence = getPresence(member.updated_at, member.status, onlineIds.has(member.id));
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
  const { isAdmin, user, activeOperator } = useAuth();
  const queryClient = useQueryClient();

  const [chatPeer, setChatPeer] = useState<StaffMember | null>(null);
  const [detailMember, setDetailMember] = useState<StaffMember | null>(null);

  useEffect(() => {
    const operatorId = activeOperator?.id ?? user?.id;
    if (!operatorId) return;
    const heartbeat = async () => {
      const now = new Date().toISOString();
      await supabase.from('user_profiles').update({ updated_at: now }).eq('id', operatorId);
      queryClient.setQueryData<StaffMember[]>(['staff'], (prev) =>
        prev?.map((s) => s.id === operatorId ? { ...s, updated_at: now } : s) ?? prev
      );
    };
    heartbeat();
    const interval = setInterval(heartbeat, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [activeOperator?.id, user?.id, queryClient]);

  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const operatorId = activeOperator?.id ?? user?.id;
    if (!operatorId) return;
    const ch = supabase.channel('online-users', {
      config: { presence: { key: operatorId } },
    });
    const syncIds = () => setOnlineIds(new Set<string>(Object.keys(ch.presenceState())));
    ch.on('presence', { event: 'sync' },  syncIds)
      .on('presence', { event: 'join' },  syncIds)
      .on('presence', { event: 'leave' }, syncIds)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await ch.track({ user_id: operatorId });
      });
    return () => { supabase.removeChannel(ch); };
  }, [activeOperator?.id, user?.id]);

  const { data: staff = [], refetch: refetchStaff } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_all_staff_profiles');
      if (!rpcError && rpcData) return rpcData as StaffMember[];
      const { data, error } = await supabase.from('user_profiles').select('*').order('last_name');
      if (error) throw error;
      return (data ?? []) as StaffMember[];
    },
    staleTime: 0,
  });

  useEffect(() => {
    const ch = supabase
      .channel('staff-presence')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_profiles' }, () => {
        refetchStaff();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetchStaff]);

  const { data: roles = [] } = useQuery({
    queryKey: ['all-roles'],
    queryFn: async () => {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_all_user_roles');
      if (!rpcError && rpcData) return rpcData as { user_id: string; role: string }[];
      const { data } = await supabase.from('user_profiles').select('id, user_roles(role)');
      return (data ?? []).flatMap((p: any) =>
        (p.user_roles ?? []).map((r: any) => ({ user_id: p.id, role: r.role }))
      );
    },
  });

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {staff.map((s) => (
          <StaffTile key={s.id} member={s} roles={roles as any[]}
            isSelf={s.id === (activeOperator?.id ?? user?.id)}
            onlineIds={onlineIds}
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
          isSelf={detailMember.id === (activeOperator?.id ?? user?.id)} isAdmin={isAdmin}
          onlineIds={onlineIds}
          onChat={() => setChatPeer(detailMember)}
          onClose={() => setDetailMember(null)}
        />
      )}

      {chatPeer && user && chatPeer.id !== (activeOperator?.id ?? user.id) && (
        <ChatWindow
          peer={chatPeer}
          currentUserId={activeOperator?.id ?? user.id}
          onlineIds={onlineIds}
          onClose={() => setChatPeer(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Org Chart Node (recursive) — improved layout with plant badge chips
// ---------------------------------------------------------------------------

function OrgNode({ member, allStaff, roles, plants, depth = 0 }: {
  member: StaffMember; allStaff: StaffMember[]; roles: any[]; plants: any[]; depth?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const children = allStaff.filter((s) => s.immediate_head_id === member.id);
  const memberRole = (roles as any[]).find((r) => r.user_id === member.id)?.role ?? '—';
  const hasChildren = children.length > 0;

  // Plant badges (only first 2 to avoid overflow; show +N for rest)
  const memberPlants = (plants ?? [])
    .filter((p) => member.plant_assignments?.includes(p.id))
    .map((p) => p.name as string);

  return (
    <div className={cn('flex flex-col', depth > 0 && 'ml-4 border-l-2 border-dashed border-muted-foreground/20 pl-3 mt-1')}>
      <div
        className={cn(
          'flex items-center gap-2 py-1.5 px-2 rounded-lg group transition-colors',
          hasChildren && 'cursor-pointer hover:bg-muted/60',
          !hasChildren && 'cursor-default',
        )}
        onClick={() => hasChildren && setExpanded((p) => !p)}
      >
        {/* Avatar */}
        <div className={cn('h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0', avatarColor(member.id))}>
          {initials(member)}
        </div>

        {/* Name + info */}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold leading-snug truncate">{fullName(member)}</div>
          <div className="flex items-center gap-1 flex-wrap mt-0.5">
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-medium">{memberRole}</span>
            {member.designation && (
              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{member.designation}</span>
            )}
          </div>
          {/* Plant badges — shown on the org node for context */}
          {memberPlants.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mt-1">
              {memberPlants.slice(0, 2).map((name) => (
                <span key={name} className="inline-flex items-center gap-0.5 text-[9px] bg-sky-50 text-sky-600 border border-sky-200 rounded px-1.5 py-0.5 font-medium">
                  <Building2 className="h-2 w-2 shrink-0" />{name}
                </span>
              ))}
              {memberPlants.length > 2 && (
                <span className="text-[9px] text-muted-foreground">+{memberPlants.length - 2}</span>
              )}
            </div>
          )}
        </div>

        {/* Expand chevron */}
        {hasChildren && (
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[9px] text-muted-foreground">{children.length}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform duration-200', expanded && 'rotate-180')} />
          </div>
        )}
      </div>

      {expanded && hasChildren && children.map((child) => (
        <OrgNode key={child.id} member={child} allStaff={allStaff} roles={roles} plants={plants} depth={depth + 1} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Org Chart — 4-column layout, one column per plant
// ---------------------------------------------------------------------------

function OrgChart({ staff, roles, plants }: { staff: StaffMember[]; roles: any[]; plants: any[] }) {
  // Track expand-all per-plant column: plantId -> boolean
  const [expandedPlants, setExpandedPlants] = useState<Record<string, boolean>>({});

  const plantsWithStaff = plants.filter((p) => staff.some((s) => s.plant_assignments?.includes(p.id)));

  const toggleAll = (plantId: string, force?: boolean) => {
    setExpandedPlants((prev) => ({
      ...prev,
      [plantId]: force !== undefined ? force : !prev[plantId],
    }));
  };

  if (plantsWithStaff.length === 0) {
    // Fallback: flat tree with no plant data
    const staffIds = new Set(staff.map((s) => s.id));
    const roots = staff.filter((s) => !s.immediate_head_id || !staffIds.has(s.immediate_head_id));
    if (roots.length === 0)
      return <p className="text-xs text-muted-foreground text-center py-4">No reporting relationships configured.</p>;
    return (
      <div className="space-y-1">
        {roots.map((r) => <OrgNode key={r.id} member={r} allStaff={staff} roles={roles} plants={plants} depth={0} />)}
      </div>
    );
  }

  // Responsive: on small screens stack columns; on md+ show up to 4 columns
  return (
    <div>
      {/* Legend / summary strip */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {plantsWithStaff.map((plant, idx) => {
          const accent = PLANT_COLUMN_ACCENTS[idx % PLANT_COLUMN_ACCENTS.length];
          const count = staff.filter((s) => s.plant_assignments?.includes(plant.id)).length;
          return (
            <div key={plant.id} className={cn('flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full border', accent.bg, accent.border, accent.text)}>
              <Building2 className="h-3 w-3 shrink-0" />
              {plant.name}
              <span className="opacity-60">·</span>
              <span className="opacity-80">{count}</span>
            </div>
          );
        })}
      </div>

      {/* 4-column grid */}
      <div className={cn(
        'grid gap-3',
        plantsWithStaff.length === 1 && 'grid-cols-1',
        plantsWithStaff.length === 2 && 'grid-cols-1 sm:grid-cols-2',
        plantsWithStaff.length === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        plantsWithStaff.length >= 4 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
      )}>
        {plantsWithStaff.map((plant, idx) => {
          const accent = PLANT_COLUMN_ACCENTS[idx % PLANT_COLUMN_ACCENTS.length];
          const plantStaff = staff.filter((s) => s.plant_assignments?.includes(plant.id));
          const plantStaffIds = new Set(plantStaff.map((s) => s.id));
          const roots = plantStaff.filter(
            (s) => !s.immediate_head_id || !plantStaffIds.has(s.immediate_head_id)
          );

          const isExpanded = !!expandedPlants[plant.id];

          return (
            <div key={plant.id} className={cn('rounded-xl border overflow-hidden flex flex-col', accent.border)}>
              {/* Plant column header */}
              <div className={cn('px-3 py-2.5 bg-gradient-to-r text-white', accent.header)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Building2 className="h-3.5 w-3.5 shrink-0 opacity-90" />
                    <span className="text-[12px] font-bold uppercase tracking-wide truncate">{plant.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] font-semibold opacity-80 bg-white/20 px-1.5 py-0.5 rounded-full">
                      {plantStaff.length}
                    </span>
                    {/* Expand-all / Collapse-all toggle */}
                    <button
                      className="h-5 w-5 flex items-center justify-center rounded hover:bg-white/20 transition-colors"
                      onClick={() => toggleAll(plant.id)}
                      title={isExpanded ? 'Collapse all' : 'Expand all'}
                    >
                      {isExpanded
                        ? <ChevronsDownUp className="h-3 w-3 opacity-80" />
                        : <ChevronsUpDown className="h-3 w-3 opacity-80" />
                      }
                    </button>
                  </div>
                </div>
              </div>

              {/* Tree nodes */}
              <div className={cn('flex-1 p-2 space-y-0.5 overflow-y-auto', accent.bg)} style={{ maxHeight: 320 }}>
                {roots.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground py-3 text-center">No hierarchy configured.</p>
                ) : (
                  <ExpandAllContext.Provider value={isExpanded}>
                    {roots.map((r) => (
                      <OrgNodeControlled key={r.id} member={r} allStaff={plantStaff} roles={roles} plants={plants} depth={0} forceExpand={isExpanded} />
                    ))}
                  </ExpandAllContext.Provider>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Context for propagating expand-all state into OrgNodeControlled
import { createContext, useContext } from 'react';
const ExpandAllContext = createContext(false);

// Controlled org node that respects forceExpand from the column header toggle
function OrgNodeControlled({ member, allStaff, roles, plants, depth = 0, forceExpand }: {
  member: StaffMember; allStaff: StaffMember[]; roles: any[]; plants: any[]; depth?: number; forceExpand: boolean;
}) {
  // Local expanded state; syncs when forceExpand changes
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = forceExpand || localExpanded;

  useEffect(() => {
    if (!forceExpand) setLocalExpanded(false);
  }, [forceExpand]);

  const children = allStaff.filter((s) => s.immediate_head_id === member.id);
  const memberRole = (roles as any[]).find((r) => r.user_id === member.id)?.role ?? '—';
  const hasChildren = children.length > 0;

  const memberPlants = (plants ?? [])
    .filter((p) => member.plant_assignments?.includes(p.id))
    .map((p) => p.name as string);

  const toggle = () => {
    if (!forceExpand) setLocalExpanded((p) => !p);
    else setLocalExpanded((p) => !p); // allow individual collapse even during expand-all
  };

  return (
    <div className={cn('flex flex-col', depth > 0 && 'ml-3 border-l-2 border-dashed border-muted-foreground/20 pl-2.5 mt-0.5')}>
      <div
        className={cn(
          'flex items-center gap-2 py-1.5 px-2 rounded-lg group transition-colors',
          hasChildren && 'cursor-pointer hover:bg-white/60',
          !hasChildren && 'cursor-default',
        )}
        onClick={() => hasChildren && toggle()}
      >
        {/* Avatar */}
        <div className={cn('h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0', avatarColor(member.id))}>
          {initials(member)}
        </div>

        {/* Name + role */}
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold leading-snug truncate">{fullName(member)}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[9px] text-muted-foreground bg-white/70 border px-1 rounded font-medium">{memberRole}</span>
            {member.designation && (
              <span className="text-[9px] text-muted-foreground truncate max-w-[80px]">{member.designation}</span>
            )}
          </div>
        </div>

        {/* Chevron + child count */}
        {hasChildren && (
          <div className="flex items-center gap-0.5 shrink-0">
            <span className="text-[9px] text-muted-foreground">{children.length}</span>
            <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform duration-200', expanded && 'rotate-180')} />
          </div>
        )}
      </div>

      {expanded && hasChildren && children.map((child) => (
        <OrgNodeControlled key={child.id} member={child} allStaff={allStaff} roles={roles} plants={plants} depth={depth + 1} forceExpand={forceExpand} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff Directory Stats
// ---------------------------------------------------------------------------

const ROLES = ['Admin', 'Manager', 'Technician', 'Operator'] as const;

function DirectoryStats({ staff, roles, plants }: { staff: StaffMember[]; roles: any[]; plants: any[] }) {
  const activeCount = staff.filter((s) => s.status === 'Active').length;

  const roleCounts = ROLES.map((role) => ({
    role,
    count: (roles as any[]).filter((r) => r.role === role).length,
  }));

  const coveredPlantIds = new Set(staff.flatMap((s) => s.plant_assignments ?? []));
  const plantsCount = plants.filter((p) => coveredPlantIds.has(p.id)).length;

  const statItems = [
    { label: 'Total Staff', value: staff.length, icon: <Users className="h-4 w-4" />, color: 'text-sky-600' },
    { label: 'Active', value: activeCount, icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-emerald-600' },
    { label: 'Plants Covered', value: plantsCount, icon: <Building2 className="h-4 w-4" />, color: 'text-violet-600' },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {statItems.map((s) => (
          <div key={s.label} className="flex flex-col items-center bg-muted/50 rounded-lg py-3 px-2 text-center gap-1">
            <span className={s.color}>{s.icon}</span>
            <span className="text-xl font-bold leading-none">{s.value}</span>
            <span className="text-[10px] text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {roleCounts.map(({ role, count }) => (
          <div key={role} className="flex items-center justify-between bg-muted/30 rounded-md px-3 py-2">
            <span className="text-xs text-muted-foreground">{role}</span>
            <span className="text-sm font-semibold">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending Approvals (admin only)
// ---------------------------------------------------------------------------

function PendingApprovals({ staff }: { staff: StaffMember[] }) {
  const queryClient = useQueryClient();
  const [approving, setApproving] = useState<string | null>(null);

  const pending = staff.filter((s) => s.status === 'Pending');

  const approve = useCallback(async (id: string) => {
    setApproving(id);
    try {
      await (supabase as any)
        .from('user_profiles')
        .update({ confirmed: true, status: 'Active' })
        .eq('id', id);
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    } finally {
      setApproving(null);
    }
  }, [queryClient]);

  if (pending.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        No pending approvals. All accounts are active.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {pending.map((s) => (
        <div key={s.id} className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <div className={cn('h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0', avatarColor(s.id))}>
            {initials(s)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{fullName(s)}</div>
            <div className="text-[11px] text-muted-foreground">@{s.username ?? '—'} · {s.designation ?? 'No designation'}</div>
          </div>
          <Button
            size="sm" variant="outline"
            className="h-7 px-2 text-[11px] text-emerald-700 border-emerald-300 hover:bg-emerald-50 shrink-0"
            disabled={approving === s.id}
            onClick={() => approve(s.id)}
          >
            {approving === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Approve'}
          </Button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App Manual
// ---------------------------------------------------------------------------

type ManualSection = { title: string; icon: ReactNode; content: ReactNode };

const MANUAL_SECTIONS: ManualSection[] = [
  {
    title: 'Getting Started',
    icon: <BookOpen className="h-3.5 w-3.5" />,
    content: (
      <div className="space-y-2 text-xs text-muted-foreground">
        <p>New staff sign up on the login page using their email and password. After email confirmation, they complete a profile setup (plants, designation, etc.).</p>
        <p>An <strong className="text-foreground">Admin</strong> must then review and approve the account. New users default to <strong className="text-foreground">Pending</strong> status and cannot access the app until approved.</p>
      </div>
    ),
  },
  {
    title: 'Roles & Permissions',
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
    content: (
      <div className="space-y-1.5 text-xs">
        {[
          { role: 'Admin', desc: 'Full access — manage staff, approve accounts, configure plants, access all data and exports.' },
          { role: 'Manager', desc: 'View and manage operations, maintenance, compliance, and incidents across assigned plants.' },
          { role: 'Technician', desc: 'Log readings, submit maintenance records, and manage incidents for assigned plants.' },
          { role: 'Operator', desc: 'View-only access to operations and dashboard. Can chat with colleagues.' },
        ].map(({ role, desc }) => (
          <div key={role} className="flex gap-2">
            <span className="font-semibold text-foreground w-20 shrink-0">{role}</span>
            <span className="text-muted-foreground">{desc}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Staff Directory',
    icon: <Users className="h-3.5 w-3.5" />,
    content: (
      <div className="space-y-2 text-xs text-muted-foreground">
        <p>The <strong className="text-foreground">Staff</strong> tab lists all registered users. Click any tile to view their full profile — designation, role, plant assignments, and who they report to.</p>
        <p>Use the <strong className="text-foreground">Chat</strong> button to send ephemeral messages (auto-deleted after 8 hours). Admins can suspend or delete accounts from the detail drawer.</p>
      </div>
    ),
  },
  {
    title: 'Org Chart',
    icon: <GitBranch className="h-3.5 w-3.5" />,
    content: (
      <div className="text-xs text-muted-foreground">
        <p>The reporting tree is grouped by plant into 4 columns. Each column shows the hierarchy for that plant based on the <strong className="text-foreground">immediate_head_id</strong> field. Use the expand/collapse button in each column header to toggle all nodes at once.</p>
      </div>
    ),
  },
  {
    title: 'Plants & Operations',
    icon: <Building2 className="h-3.5 w-3.5" />,
    content: (
      <div className="space-y-2 text-xs text-muted-foreground">
        <p>Each plant has its own wells, locators, RO trains, and chemical dosing configuration. Staff are assigned to plants; their access is scoped accordingly.</p>
        <p>Daily readings (flow, pressure, energy, pH) are logged under each plant. Data is queryable through the AI Assistant and exportable via <strong className="text-foreground">Data Exports</strong>.</p>
      </div>
    ),
  },
  {
    title: 'Maintenance & Incidents',
    icon: <ClipboardList className="h-3.5 w-3.5" />,
    content: (
      <div className="space-y-2 text-xs text-muted-foreground">
        <p><strong className="text-foreground">PM Schedule</strong> tracks preventive maintenance tasks with due dates and completion status. Overdue items are flagged automatically.</p>
        <p><strong className="text-foreground">Incidents</strong> records downtime events, equipment failures, and safety observations. Each incident can be linked to a specific plant and tagged with a severity level.</p>
      </div>
    ),
  },
];

function AppManual() {
  const [openSet, setOpenSet] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  return (
    <div className="space-y-1.5">
      {MANUAL_SECTIONS.map((s, i) => (
        <div key={i} className="border rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
            onClick={() => toggle(i)}
          >
            <span className="text-muted-foreground">{s.icon}</span>
            <span className="text-sm font-medium flex-1">{s.title}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', openSet.has(i) && 'rotate-180')} />
          </button>
          {openSet.has(i) && (
            <div className="px-4 pb-3 pt-1 border-t bg-muted/20">
              {s.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Info Tab
// ---------------------------------------------------------------------------

function RegisterInfo() {
  const { data: plants = [] } = usePlants();
  const [orgOpen, setOrgOpen] = useState(false);

  const { data: staff = [] } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_all_staff_profiles');
      if (!rpcError && rpcData) return rpcData as StaffMember[];
      const { data, error } = await supabase.from('user_profiles').select('*').order('last_name');
      if (error) throw error;
      return (data ?? []) as StaffMember[];
    },
    staleTime: 30_000,
  });

  const { data: roles = [] } = useQuery({
    queryKey: ['all-roles'],
    queryFn: async () => {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_all_user_roles');
      if (!rpcError && rpcData) return rpcData as { user_id: string; role: string }[];
      const { data } = await supabase.from('user_profiles').select('id, user_roles(role)');
      return (data ?? []).flatMap((p: any) =>
        (p.user_roles ?? []).map((r: any) => ({ user_id: p.id, role: r.role }))
      );
    },
  });

  return (
    <div className="space-y-3">

      {/* Org Chart */}
      <Card className="overflow-hidden">
        <button
          className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
          onClick={() => setOrgOpen((p) => !p)}
        >
          <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold flex-1">Reporting Tree</span>
          <span className="text-[10px] text-muted-foreground mr-1">by plant</span>
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', orgOpen && 'rotate-180')} />
        </button>
        {orgOpen && (
          <div className="border-t px-4 py-3">
            <OrgChart staff={staff} roles={roles} plants={plants} />
          </div>
        )}
      </Card>

      {/* App Manual */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b">
          <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold">App Manual</span>
        </div>
        <div className="p-3">
          <AppManual />
        </div>
      </Card>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Employees() {
  const [tab, setTab] = useTabPersist<'staff' | 'info'>('tab:employees', 'staff');
  return (
    <div className="space-y-3 animate-fade-in">
      <h1 className="text-xl font-semibold tracking-tight">Employees</h1>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
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
