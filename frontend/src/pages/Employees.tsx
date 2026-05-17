import { useCallback, useEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import { useTabPersist } from '@/hooks/useTabPersist';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, X, Send, Loader2, Clock,
  Building2, User, ShieldCheck, MapPin, ChevronRight,
  Users, CheckCircle2, AlertCircle, BookOpen, ChevronDown,
  GitBranch, ClipboardList, Check, CheckCheck,
  Search, BarChart2, ChevronLeft, Info,
  Crown, Briefcase, Settings, UserCircle,
  RefreshCw, ZoomIn,
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

// Reading record (for KPI)
type ReadingRecord = {
  plant_id: string;
  reading_datetime: string;
  recorded_by: string | null;
};

// Checklist execution (for KPI)
type ChecklistExecution = {
  template_id: string;
  execution_date: string;
  completed: boolean;
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

const PLANT_COLUMN_ACCENTS = [
  { header: 'from-sky-600 to-sky-500',      border: 'border-sky-200',   bg: 'bg-sky-50',    text: 'text-sky-700',    line: '#0ea5e9' },
  { header: 'from-teal-600 to-teal-500',    border: 'border-teal-200',  bg: 'bg-teal-50',   text: 'text-teal-700',   line: '#14b8a6' },
  { header: 'from-cyan-600 to-cyan-500',    border: 'border-cyan-200',  bg: 'bg-cyan-50',   text: 'text-cyan-700',   line: '#06b6d4' },
  { header: 'from-sky-700 to-teal-600',     border: 'border-sky-300',   bg: 'bg-sky-100',   text: 'text-sky-800',    line: '#0369a1' },
  { header: 'from-teal-700 to-cyan-600',    border: 'border-teal-300',  bg: 'bg-teal-100',  text: 'text-teal-800',   line: '#0f766e' },
  { header: 'from-cyan-700 to-sky-600',     border: 'border-cyan-300',  bg: 'bg-cyan-100',  text: 'text-cyan-800',   line: '#0e7490' },
];

const DEPTH_SHADES = [
  'bg-white',
  'bg-sky-50/80',
  'bg-sky-100/70',
  'bg-teal-50/80',
  'bg-teal-100/70',
  'bg-cyan-50/80',
];

const CONNECTOR_COLORS = ['#0ea5e9', '#14b8a6', '#06b6d4', '#0369a1', '#0f766e', '#0e7490'];

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
// Role hierarchy config
// ---------------------------------------------------------------------------

const ROLE_HIERARCHY: { role: string; level: number; icon: ReactNode; color: string; bg: string }[] = [
  { role: 'Admin',         level: 0, icon: <Crown className="h-3 w-3" />,        color: 'text-rose-700',    bg: 'bg-rose-50 border-rose-200' },
  { role: 'Manager',       level: 1, icon: <Briefcase className="h-3 w-3" />,    color: 'text-sky-700',     bg: 'bg-sky-50 border-sky-200' },
  { role: 'Data Analyst',  level: 2, icon: <BarChart2 className="h-3 w-3" />,    color: 'text-violet-700',  bg: 'bg-violet-50 border-violet-200' },
  { role: 'Technician',    level: 3, icon: <Settings className="h-3 w-3" />,     color: 'text-teal-700',    bg: 'bg-teal-50 border-teal-200' },
  { role: 'Operator',      level: 4, icon: <UserCircle className="h-3 w-3" />,   color: 'text-zinc-700',    bg: 'bg-zinc-50 border-zinc-200' },
];

function getRoleConfig(role: string) {
  return ROLE_HIERARCHY.find((r) => r.role === role) ?? ROLE_HIERARCHY[4];
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

function MsgStatus({ isMine, msgId, messages }: { isMine: boolean; msgId: string; messages: ChatMsg[] }) {
  if (!isMine) return null;
  const idx = messages.findIndex((m) => m.id === msgId);
  const delivered = idx !== -1;
  return delivered
    ? <CheckCheck className="h-2.5 w-2.5 text-sky-300 shrink-0" />
    : <Check className="h-2.5 w-2.5 text-white/50 shrink-0" />;
}

// ---------------------------------------------------------------------------
// Chat Window
// ---------------------------------------------------------------------------

function ChatWindow({ peer, currentUserId, onClose, onlineIds }: {
  peer: StaffMember; currentUserId: string; onClose: () => void; onlineIds: Set<string>;
}) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const peerTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [optimisticIds] = useState(() => new Set<string>());
  const bottomRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
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
        if (payload?.sender_id && payload.sender_id !== currentUserId) {
          setPeerTyping(true);
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, peerTyping]);

  const broadcastTyping = useCallback(() => {
    if (typingBroadcastTimer.current) return;
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

  return (
    <div
      className={cn(
        'fixed z-50 bg-background border border-border shadow-2xl flex flex-col overflow-hidden',
        'bottom-0 left-0 right-0 rounded-t-xl',
        'md:bottom-4 md:left-auto md:right-4 md:rounded-xl md:w-80',
      )}
      style={{ height: 'min(460px, 80dvh)' }}
    >
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

      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border-b border-amber-100 text-amber-700 text-[10px] shrink-0">
        <Clock className="h-3 w-3 shrink-0" />
        Messages auto-delete after 8 hours. No content is retained.
      </div>

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
// Staff Tile — compact circular design
// ---------------------------------------------------------------------------

function StaffTile({ member, roles, isSelf, onlineIds, onChat, onDetail }: {
  member: StaffMember; roles: any[]; isSelf: boolean; onlineIds: Set<string>; onChat: () => void; onDetail: () => void;
}) {
  const presence = getPresence(member.updated_at, member.status, onlineIds.has(member.id));
  const pc = presenceConfig[presence];
  const memberRole = (roles as any[]).find((r) => r.user_id === member.id)?.role ?? '—';
  const rc = getRoleConfig(memberRole);

  return (
    <div
      className="relative bg-card rounded-xl border p-3 flex flex-col items-center gap-1.5 hover:shadow-md transition-all cursor-pointer group hover:border-sky-300"
      onClick={onDetail}
    >
      {/* Avatar circle */}
      <div className="relative">
        <div className={cn('h-11 w-11 rounded-full flex items-center justify-center text-sm font-bold text-white', avatarColor(member.id))}>
          {initials(member)}
        </div>
        <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background', pc.dot)} />
      </div>

      {/* Name */}
      <div className="text-center min-w-0 w-full">
        <div className="font-medium text-xs leading-tight truncate text-center">
          {fullName(member)}
          {isSelf && <span className="ml-1 text-[9px] text-muted-foreground">(you)</span>}
        </div>
        <div className={cn('inline-flex items-center gap-0.5 mt-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full border', rc.bg, rc.color)}>
          {rc.icon}
          <span>{memberRole}</span>
        </div>
      </div>

      {/* Status + Chat */}
      <div className="flex items-center gap-1.5 w-full justify-center">
        <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full border font-medium', pc.badge)}>{pc.label}</span>
        {!isSelf && (
          <button
            className="h-5 w-5 flex items-center justify-center rounded-full bg-sky-50 text-sky-600 hover:bg-sky-100 transition-colors shrink-0"
            onClick={(e) => { e.stopPropagation(); onChat(); }}
            title="Chat"
          >
            <MessageSquare className="h-3 w-3" />
          </button>
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
  const [search, setSearch] = useState('');
  const [filterPlant, setFilterPlant] = useState<string>('all');

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

  // Filter staff
  const filteredStaff = useMemo(() => {
    const q = search.toLowerCase();
    return staff.filter((s) => {
      const nameMatch = !q || fullName(s).toLowerCase().includes(q) || (s.username ?? '').toLowerCase().includes(q);
      const plantMatch = filterPlant === 'all' || s.plant_assignments?.includes(filterPlant);
      return nameMatch && plantMatch;
    });
  }, [staff, search, filterPlant]);

  const plantsWithStaff = (plants ?? []).filter((p) => staff.some((s) => s.plant_assignments?.includes(p.id)));
  const onlineCount = staff.filter((s) => onlineIds.has(s.id) || getPresence(s.updated_at, s.status, onlineIds.has(s.id)) === 'active').length;

  return (
    <>
      {/* Search + Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search staff…"
            className="pl-8 h-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterPlant}
            onChange={(e) => setFilterPlant(e.target.value)}
            className="h-8 text-xs border rounded-md px-2 bg-background text-foreground"
          >
            <option value="all">All plants</option>
            {plantsWithStaff.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            <span className="text-emerald-600 font-semibold">{onlineCount}</span> active · {filteredStaff.length} shown
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
        {filteredStaff.map((s) => (
          <StaffTile key={s.id} member={s} roles={roles as any[]}
            isSelf={s.id === (activeOperator?.id ?? user?.id)}
            onlineIds={onlineIds}
            onChat={() => setChatPeer(s)}
            onDetail={() => setDetailMember(s)}
          />
        ))}
        {filteredStaff.length === 0 && (
          <div className="col-span-full">
            <Card className="p-6 text-xs text-center text-muted-foreground">
              {search || filterPlant !== 'all' ? 'No staff match your filters.' : 'No staff found.'}
            </Card>
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
// Org Chart — always-expanded nodes with hierarchy lines
// ---------------------------------------------------------------------------

function OrgNodeFixed({ member, allStaff, roles, depth = 0, accentLine }: {
  member: StaffMember; allStaff: StaffMember[]; roles: any[];
  depth?: number; accentLine?: string;
}) {
  const children = allStaff.filter((s) => s.immediate_head_id === member.id);
  const memberRole = (roles as any[]).find((r) => r.user_id === member.id)?.role ?? '—';
  const hasChildren = children.length > 0;
  const depthShade = DEPTH_SHADES[Math.min(depth, DEPTH_SHADES.length - 1)];
  const lineColor = accentLine ?? CONNECTOR_COLORS[Math.min(depth, CONNECTOR_COLORS.length - 1)];
  const childLineColor = CONNECTOR_COLORS[Math.min(depth + 1, CONNECTOR_COLORS.length - 1)];
  const rc = getRoleConfig(memberRole);

  return (
    <div className="flex flex-col">
      {/* Elbow connector at depth > 0 */}
      {depth > 0 && (
        <div className="flex items-center" style={{ paddingLeft: (depth - 1) * 16 }}>
          <div className="flex items-center shrink-0" style={{ width: 16 }}>
            <div style={{ width: 2, height: 10, background: lineColor, opacity: 0.5 }} />
            <div style={{ width: 8, height: 2, background: lineColor, opacity: 0.5 }} />
          </div>
        </div>
      )}

      <div
        style={{ paddingLeft: depth * 16 }}
        className={cn(
          'flex items-center gap-1.5 py-1.5 pr-2 rounded-lg relative',
          depthShade,
        )}
      >
        {depth > 0 && (
          <div
            className="absolute top-1 bottom-1 w-0.5 rounded-full"
            style={{ background: lineColor, opacity: 0.35, left: depth * 16 - 4 }}
          />
        )}

        {/* Avatar */}
        <div className={cn('h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0', avatarColor(member.id))}>
          {initials(member)}
        </div>

        {/* Name + role */}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold leading-snug truncate">{fullName(member)}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <span
              className={cn('inline-flex items-center gap-0.5 text-[9px] font-medium px-1 py-0.5 rounded border', rc.bg, rc.color)}
            >
              {rc.icon}
              <span>{memberRole}</span>
            </span>
            {member.designation && (
              <span className="text-[9px] text-muted-foreground truncate max-w-[72px]">{member.designation}</span>
            )}
          </div>
        </div>

        {hasChildren && (
          <span
            className="text-[8px] font-bold px-1 rounded shrink-0"
            style={{ color: lineColor, background: `${lineColor}20` }}
          >
            {children.length}
          </span>
        )}
      </div>

      {/* Always-expanded children with vertical trunk line */}
      {hasChildren && (
        <div className="flex">
          <div style={{ width: depth * 16 + 9, flexShrink: 0, paddingLeft: depth * 16 }}>
            <div style={{ width: 2, height: '100%', background: childLineColor, opacity: 0.25, marginLeft: 9 }} />
          </div>
          <div className="flex-1 min-w-0">
            {children.map((child) => (
              <OrgNodeFixed
                key={child.id} member={child} allStaff={allStaff} roles={roles}
                depth={depth + 1} accentLine={childLineColor}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hierarchy Legend
// ---------------------------------------------------------------------------

function HierarchyLegend() {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3 px-1">
      {ROLE_HIERARCHY.map((r, i) => (
        <div key={r.role} className="flex items-center gap-1">
          <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border', r.bg, r.color)}>
            {r.icon} {r.role}
          </span>
          {i < ROLE_HIERARCHY.length - 1 && (
            <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Org Chart — fixed, always visible, always expanded
// ---------------------------------------------------------------------------

function OrgChart({ staff, roles, plants }: { staff: StaffMember[]; roles: any[]; plants: any[] }) {
  const plantsWithStaff = plants.filter((p) => staff.some((s) => s.plant_assignments?.includes(p.id)));

  if (plantsWithStaff.length === 0) {
    const staffIds = new Set(staff.map((s) => s.id));
    const roots = staff.filter((s) => !s.immediate_head_id || !staffIds.has(s.immediate_head_id));
    return (
      <div className="space-y-1">
        {roots.map((r) => <OrgNodeFixed key={r.id} member={r} allStaff={staff} roles={roles} depth={0} />)}
      </div>
    );
  }

  return (
    <div>
      <HierarchyLegend />

      {/* Summary strip */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {plantsWithStaff.map((plant, idx) => {
          const accent = PLANT_COLUMN_ACCENTS[idx % PLANT_COLUMN_ACCENTS.length];
          const count = staff.filter((s) => s.plant_assignments?.includes(plant.id)).length;
          return (
            <div key={plant.id}
              className={cn('flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full border', accent.bg, accent.border, accent.text)}
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: accent.line }} />
              {plant.name}
              <span className="opacity-50 mx-0.5">·</span>
              <span className="font-bold">{count} staff</span>
            </div>
          );
        })}
      </div>

      {/* Plant columns — always expanded */}
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

          return (
            <div key={plant.id} className={cn('rounded-xl border overflow-hidden flex flex-col', accent.border)}>
              {/* Column header */}
              <div className={cn('px-3 py-2 bg-gradient-to-r text-white', accent.header)}>
                <div className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 shrink-0 opacity-90" />
                  <span className="text-[12px] font-bold uppercase tracking-wide truncate flex-1">{plant.name}</span>
                  <span className="text-[10px] font-semibold opacity-80 bg-white/20 px-1.5 py-0.5 rounded-full">
                    {plantStaff.length}
                  </span>
                </div>
              </div>

              {/* Tree nodes — fully expanded */}
              <div className={cn('flex-1 p-2 space-y-0.5 overflow-y-auto', accent.bg)} style={{ maxHeight: 380 }}>
                {roots.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground py-3 text-center">No hierarchy configured.</p>
                ) : (
                  roots.map((r) => (
                    <OrgNodeFixed
                      key={r.id} member={r} allStaff={plantStaff} roles={roles}
                      depth={0} accentLine={accent.line}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI Tab — Employee field-update heatmap
// ---------------------------------------------------------------------------

type KpiRange = 7 | 14 | 30;
type KpiView = 'plant' | 'employee';

// Completeness score 0–3 (one point per reading type: well, locator, ro_train)
type DayScore = { count: number; total: number };
type PlantDayMap = Record<string, Record<string, DayScore>>; // plantId → dateStr → score
type EmployeeDayMap = Record<string, Record<string, number>>; // userId → dateStr → count

const KPI_COLORS = {
  full:    { bg: '#22c55e', label: 'Complete',  desc: 'All reading types logged' },
  partial: { bg: '#eab308', label: 'Partial',   desc: 'Some readings missing' },
  few:     { bg: '#f97316', label: 'Minimal',   desc: 'Very few readings' },
  none:    { bg: '#ef4444', label: 'Missed',    desc: 'No readings logged' },
  na:      { bg: '#d1d5db', label: 'No data',   desc: 'Not applicable' },
};

function kpiColor(score: number, total: number): string {
  if (total === 0) return KPI_COLORS.na.bg;
  const pct = score / total;
  if (pct >= 0.9) return KPI_COLORS.full.bg;
  if (pct >= 0.5) return KPI_COLORS.partial.bg;
  if (pct > 0)    return KPI_COLORS.few.bg;
  return KPI_COLORS.none.bg;
}

function kpiEmployeeColor(count: number): string {
  if (count >= 10) return KPI_COLORS.full.bg;
  if (count >= 4)  return KPI_COLORS.partial.bg;
  if (count >= 1)  return KPI_COLORS.few.bg;
  return KPI_COLORS.none.bg;
}

function generateDays(range: KpiRange): string[] {
  const days: string[] = [];
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function formatDayLabel(dateStr: string, range: KpiRange): string {
  const d = new Date(dateStr + 'T00:00:00');
  if (range <= 7) return d.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
  if (range <= 14) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  // 30-day: show only every 5th
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function KpiTab({ staff, roles, plants }: { staff: StaffMember[]; roles: any[]; plants: any[] }) {
  const [range, setRange] = useState<KpiRange>(14);
  const [view, setView] = useState<KpiView>('plant');
  const [drillPlantId, setDrillPlantId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - range);
    return d.toISOString();
  }, [range, refreshKey]);

  // Fetch all reading types for the date range
  const { data: wellData = [], isLoading: wellLoading } = useQuery<ReadingRecord[]>({
    queryKey: ['kpi-well', since, refreshKey],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('well_readings')
        .select('plant_id, reading_datetime, recorded_by')
        .gte('reading_datetime', since);
      if (error) return [];
      return data as ReadingRecord[];
    },
    staleTime: 5 * 60_000,
  });

  const { data: locatorData = [], isLoading: locLoading } = useQuery<ReadingRecord[]>({
    queryKey: ['kpi-locator', since, refreshKey],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('locator_readings')
        .select('plant_id, reading_datetime, recorded_by')
        .gte('reading_datetime', since);
      if (error) return [];
      return data as ReadingRecord[];
    },
    staleTime: 5 * 60_000,
  });

  const { data: roData = [], isLoading: roLoading } = useQuery<ReadingRecord[]>({
    queryKey: ['kpi-ro', since, refreshKey],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ro_train_readings')
        .select('plant_id, reading_datetime, recorded_by')
        .gte('reading_datetime', since);
      if (error) return [];
      return data as ReadingRecord[];
    },
    staleTime: 5 * 60_000,
  });

  const isLoading = wellLoading || locLoading || roLoading;
  const days = useMemo(() => generateDays(range), [range, refreshKey]);

  // Build plant-level completeness map
  const plantDayMap = useMemo((): PlantDayMap => {
    const map: PlantDayMap = {};
    const allPlantsInData = new Set([
      ...wellData.map((r) => r.plant_id),
      ...locatorData.map((r) => r.plant_id),
      ...roData.map((r) => r.plant_id),
    ]);

    allPlantsInData.forEach((pid) => {
      map[pid] = {};
      days.forEach((day) => {
        const hasWell = wellData.some((r) => r.plant_id === pid && r.reading_datetime.slice(0, 10) === day);
        const hasLocator = locatorData.some((r) => r.plant_id === pid && r.reading_datetime.slice(0, 10) === day);
        const hasRo = roData.some((r) => r.plant_id === pid && r.reading_datetime.slice(0, 10) === day);
        map[pid][day] = { count: (hasWell ? 1 : 0) + (hasLocator ? 1 : 0) + (hasRo ? 1 : 0), total: 3 };
      });
    });
    return map;
  }, [wellData, locatorData, roData, days]);

  // Build employee-level submission count map
  const employeeDayMap = useMemo((): EmployeeDayMap => {
    const map: EmployeeDayMap = {};
    const allRecords = [...wellData, ...locatorData, ...roData].filter((r) => {
      if (!r.recorded_by) return false;
      if (!drillPlantId) return true;
      return r.plant_id === drillPlantId;
    });

    allRecords.forEach((r) => {
      const uid = r.recorded_by!;
      const day = r.reading_datetime.slice(0, 10);
      if (!map[uid]) map[uid] = {};
      map[uid][day] = (map[uid][day] ?? 0) + 1;
    });
    return map;
  }, [wellData, locatorData, roData, drillPlantId]);

  const plantsWithData = useMemo(() => {
    return plants.filter((p) => plantDayMap[p.id] !== undefined || staff.some((s) => s.plant_assignments?.includes(p.id)));
  }, [plants, plantDayMap, staff]);

  const drillPlant = drillPlantId ? plants.find((p) => p.id === drillPlantId) : null;

  // Employees to show in drill-down
  const drillEmployees = useMemo(() => {
    if (!drillPlantId) return staff;
    return staff.filter((s) => s.plant_assignments?.includes(drillPlantId));
  }, [staff, drillPlantId]);

  // Show only every Nth day label to avoid clutter
  const shouldShowLabel = (idx: number) => {
    if (range <= 7) return true;
    if (range <= 14) return idx % 2 === 0;
    return idx % 5 === 0 || idx === days.length - 1;
  };

  const CELL_SIZE = range <= 7 ? 26 : range <= 14 ? 20 : 14;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* View toggle */}
        <div className="flex rounded-lg border overflow-hidden">
          <button
            className={cn('px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5',
              view === 'plant' ? 'bg-sky-600 text-white' : 'hover:bg-muted')}
            onClick={() => { setView('plant'); setDrillPlantId(null); }}
          >
            <Building2 className="h-3 w-3" /> By Plant
          </button>
          <button
            className={cn('px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5',
              view === 'employee' ? 'bg-sky-600 text-white' : 'hover:bg-muted')}
            onClick={() => setView('employee')}
          >
            <Users className="h-3 w-3" /> By Employee
          </button>
        </div>

        {/* Range */}
        <div className="flex rounded-lg border overflow-hidden">
          {([7, 14, 30] as KpiRange[]).map((r) => (
            <button
              key={r}
              className={cn('px-3 py-1.5 text-xs font-medium transition-colors',
                range === r ? 'bg-sky-600 text-white' : 'hover:bg-muted')}
              onClick={() => setRange(r)}
            >
              {r}d
            </button>
          ))}
        </div>

        {/* Drill-down breadcrumb */}
        {drillPlantId && drillPlant && (
          <div className="flex items-center gap-1.5 text-xs">
            <button
              className="flex items-center gap-1 text-sky-600 hover:underline"
              onClick={() => setDrillPlantId(null)}
            >
              <ChevronLeft className="h-3 w-3" /> All Plants
            </button>
            <span className="text-muted-foreground">›</span>
            <span className="font-medium">{drillPlant.name}</span>
          </div>
        )}

        <div className="flex-1" />

        <Button
          size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
          onClick={() => setRefreshKey((k) => k + 1)}
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] text-muted-foreground font-medium">Legend:</span>
        {Object.entries(KPI_COLORS).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1">
            <div className="h-3 w-3 rounded-sm" style={{ background: cfg.bg }} />
            <span className="text-[10px] text-muted-foreground">{cfg.label}</span>
          </div>
        ))}
      </div>

      {/* Info box */}
      <div className="flex items-start gap-2 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 text-xs text-sky-700">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          Tracks daily submission of <strong>well readings</strong>, <strong>locator readings</strong>, and <strong>RO train readings</strong> per plant.
          {view === 'plant'
            ? ' Click any plant row to drill down by employee.'
            : ' Columns show submission count per employee per day.'}
        </span>
      </div>

      {/* Heatmap */}
      <Card className="overflow-auto p-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading KPI data…
          </div>
        ) : (
          <div className="min-w-0">
            {/* Day header */}
            <div className="flex items-end gap-0.5 mb-1" style={{ paddingLeft: 140 }}>
              {days.map((day, idx) => (
                <div
                  key={day}
                  style={{ width: CELL_SIZE, flexShrink: 0 }}
                  className="text-[8px] text-muted-foreground text-center leading-tight"
                >
                  {shouldShowLabel(idx) ? (
                    <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', display: 'inline-block', height: 36 }}>
                      {formatDayLabel(day, range)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Rows */}
            {view === 'plant' && !drillPlantId && (
              <div className="space-y-0.5">
                {plantsWithData.map((plant, pi) => {
                  const accent = PLANT_COLUMN_ACCENTS[pi % PLANT_COLUMN_ACCENTS.length];
                  const dayData = plantDayMap[plant.id] ?? {};
                  return (
                    <div
                      key={plant.id}
                      className="flex items-center gap-0.5 group cursor-pointer rounded hover:bg-muted/30"
                      onClick={() => { setDrillPlantId(plant.id); setView('employee'); }}
                    >
                      {/* Row label */}
                      <div className="flex items-center gap-1.5 shrink-0" style={{ width: 136 }}>
                        <div
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ background: accent.line }}
                        />
                        <span className="text-[11px] font-semibold truncate" style={{ color: accent.line }}>{plant.name}</span>
                        <ZoomIn className="h-2.5 w-2.5 text-muted-foreground opacity-0 group-hover:opacity-70 shrink-0" />
                      </div>

                      {/* Cells */}
                      <div className="flex items-center gap-0.5">
                        {days.map((day) => {
                          const score = dayData[day];
                          const color = score ? kpiColor(score.count, score.total) : KPI_COLORS.na.bg;
                          const tip = score
                            ? `${plant.name} · ${day}\n${score.count}/${score.total} reading types`
                            : `${plant.name} · ${day}\nNo data`;
                          return (
                            <div
                              key={day}
                              style={{ width: CELL_SIZE, height: CELL_SIZE, background: color, flexShrink: 0, opacity: 0.9 }}
                              className="rounded-sm cursor-default"
                              onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, text: tip })}
                              onMouseLeave={() => setTooltip(null)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Employee view (either global or drill-down) */}
            {(view === 'employee') && (
              <div className="space-y-0.5">
                {drillEmployees.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">No employees for this plant.</p>
                )}
                {drillEmployees.map((emp) => {
                  const dayData = employeeDayMap[emp.id] ?? {};
                  const memberRole = (roles as any[]).find((r) => r.user_id === emp.id)?.role ?? '—';
                  const rc = getRoleConfig(memberRole);
                  return (
                    <div key={emp.id} className="flex items-center gap-0.5 rounded hover:bg-muted/30">
                      {/* Row label */}
                      <div className="flex items-center gap-1.5 shrink-0" style={{ width: 136 }}>
                        <div className={cn('h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0', avatarColor(emp.id))}>
                          {initials(emp)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold truncate leading-tight">{fullName(emp)}</div>
                          <div className={cn('inline-flex items-center gap-0.5 text-[8px] font-medium', rc.color)}>
                            {rc.icon} {memberRole}
                          </div>
                        </div>
                      </div>

                      {/* Cells */}
                      <div className="flex items-center gap-0.5">
                        {days.map((day) => {
                          const count = dayData[day] ?? 0;
                          const color = kpiEmployeeColor(count);
                          const tip = `${fullName(emp)} · ${day}\n${count} reading(s) logged`;
                          return (
                            <div
                              key={day}
                              style={{ width: CELL_SIZE, height: CELL_SIZE, background: color, flexShrink: 0, opacity: 0.9 }}
                              className="rounded-sm cursor-default"
                              onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, text: tip })}
                              onMouseLeave={() => setTooltip(null)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-zinc-900 text-white text-[10px] rounded-lg px-2.5 py-2 shadow-lg pointer-events-none whitespace-pre leading-relaxed"
          style={{ left: tooltip.x + 12, top: tooltip.y - 12 }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        {(() => {
          const allScores = plantsWithData.flatMap((p) =>
            days.map((d) => plantDayMap[p.id]?.[d] ?? { count: 0, total: 0 })
          ).filter((s) => s.total > 0);
          const total = allScores.length;
          const full = allScores.filter((s) => s.count === s.total).length;
          const missed = allScores.filter((s) => s.count === 0).length;
          const pct = total > 0 ? Math.round((full / total) * 100) : 0;
          return [
            { label: 'Compliance Rate', value: `${pct}%`, color: pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600' },
            { label: 'Days Fully Logged', value: `${full}/${total}`, color: 'text-sky-600' },
            { label: 'Days Missed', value: `${missed}`, color: missed === 0 ? 'text-emerald-600' : 'text-red-600' },
          ];
        })().map((s) => (
          <div key={s.label} className="flex flex-col items-center bg-muted/40 rounded-lg py-3 px-2 text-center gap-0.5">
            <span className={cn('text-xl font-bold leading-none', s.color)}>{s.value}</span>
            <span className="text-[10px] text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>
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
        {roleCounts.map(({ role, count }) => {
          const rc = getRoleConfig(role);
          return (
            <div key={role} className="flex items-center justify-between bg-muted/30 rounded-md px-3 py-2">
              <div className={cn('flex items-center gap-1.5 text-xs', rc.color)}>
                {rc.icon}
                <span className="text-muted-foreground">{role}</span>
              </div>
              <span className="text-sm font-semibold">{count}</span>
            </div>
          );
        })}
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
        {ROLE_HIERARCHY.map(({ role, icon, color, bg }) => {
          const descs: Record<string, string> = {
            Admin: 'Full access — manage staff, approve accounts, configure plants, access all data and exports.',
            Manager: 'View and manage operations, maintenance, compliance, and incidents across assigned plants.',
            'Data Analyst': 'Access to data analysis, reports, and AI assistant. No write access to operational data.',
            Technician: 'Log readings, submit maintenance records, and manage incidents for assigned plants.',
            Operator: 'View-only access to operations and dashboard. Can chat with colleagues.',
          };
          return (
            <div key={role} className="flex gap-2">
              <span className={cn('inline-flex items-center gap-1 font-semibold text-foreground w-28 shrink-0 text-[10px]', color)}>
                {icon} {role}
              </span>
              <span className="text-muted-foreground">{descs[role] ?? '—'}</span>
            </div>
          );
        })}
      </div>
    ),
  },
  {
    title: 'Staff Directory',
    icon: <Users className="h-3.5 w-3.5" />,
    content: (
      <div className="space-y-2 text-xs text-muted-foreground">
        <p>The <strong className="text-foreground">Staff</strong> tab lists all registered users. Click any tile to view their full profile. Use the search and plant filter to narrow results.</p>
        <p>Use the <strong className="text-foreground">Chat</strong> button to send ephemeral messages (auto-deleted after 8 hours).</p>
      </div>
    ),
  },
  {
    title: 'Employee KPI',
    icon: <BarChart2 className="h-3.5 w-3.5" />,
    content: (
      <div className="space-y-2 text-xs text-muted-foreground">
        <p>The <strong className="text-foreground">KPI</strong> tab shows a heatmap of daily field updates — well readings, locator readings, and RO train readings — per plant and employee.</p>
        <p>Green = all reading types logged · Yellow = partial · Orange = minimal · Red = none logged. Click any plant row to drill down by individual employee.</p>
      </div>
    ),
  },
  {
    title: 'Org Chart',
    icon: <GitBranch className="h-3.5 w-3.5" />,
    content: (
      <div className="text-xs text-muted-foreground">
        <p>The <strong className="text-foreground">Reporting Tree</strong> is always visible in the Info tab, grouped by plant. The hierarchy follows Admin → Manager → Data Analyst → Technician → Operator levels based on the <strong className="text-foreground">immediate_head_id</strong> field.</p>
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

  const { isAdmin } = useAuth();

  return (
    <div className="space-y-3">

      {/* Directory Stats */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b">
          <Users className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold">Directory Overview</span>
        </div>
        <div className="p-3">
          <DirectoryStats staff={staff} roles={roles} plants={plants} />
        </div>
      </Card>

      {/* Pending Approvals — admin only */}
      {isAdmin && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-sm font-semibold">Pending Approvals</span>
          </div>
          <div className="p-3">
            <PendingApprovals staff={staff} />
          </div>
        </Card>
      )}

      {/* Reporting Tree — always visible, not foldable */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b">
          <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold">Reporting Tree</span>
          <span className="text-[10px] text-muted-foreground ml-1">by plant</span>
        </div>
        <div className="px-4 py-3">
          <OrgChart staff={staff} roles={roles} plants={plants} />
        </div>
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
  const [tab, setTab] = useTabPersist<'staff' | 'kpi' | 'info'>('tab:employees', 'staff');

  const { data: plants = [] } = usePlants();

  const { data: staff = [] } = useQuery<StaffMember[]>({
    queryKey: ['staff'],
    queryFn: async () => {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_all_staff_profiles');
      if (!rpcError && rpcData) return rpcData as StaffMember[];
      const { data, error } = await supabase.from('user_profiles').select('*').order('last_name');
      if (error) throw error;
      return (data ?? []) as StaffMember[];
    },
    staleTime: 60_000,
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
    <div className="space-y-3 animate-fade-in">
      <h1 className="text-xl font-semibold tracking-tight">Employees</h1>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="staff" className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Staff
          </TabsTrigger>
          <TabsTrigger value="kpi" className="flex items-center gap-1.5">
            <BarChart2 className="h-3.5 w-3.5" /> KPI
          </TabsTrigger>
          <TabsTrigger value="info" className="flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5" /> Info
          </TabsTrigger>
        </TabsList>
        <TabsContent value="staff" className="mt-3"><Staff /></TabsContent>
        <TabsContent value="kpi" className="mt-3">
          <KpiTab staff={staff} roles={roles} plants={plants} />
        </TabsContent>
        <TabsContent value="info" className="mt-3"><RegisterInfo /></TabsContent>
      </Tabs>
    </div>
  );
}
