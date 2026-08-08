import React, { useCallback, useEffect, useRef, useState, useMemo, Fragment, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTabPersist } from '@/hooks/useTabPersist';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, X, Send, Loader2, Clock,
  Building2, User, ShieldCheck, MapPin, ChevronRight,
  Users, CheckCircle2, AlertCircle, BookOpen, ChevronDown,
  GitBranch, ClipboardList, Check, CheckCheck,
  Search, BarChart2, ChevronLeft, Info,
  Crown, Briefcase, Cog, UserCircle,
  RefreshCw, ZoomIn,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { DataState } from '@/components/DataState';
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
  active:  { label: 'Active',  dot: 'bg-accent', badge: 'bg-accent-soft text-accent border-accent' },
  idle:    { label: 'Idle',    dot: 'bg-warn',   badge: 'bg-warn-soft text-warn border-warn' },
  away:    { label: 'Away',    dot: 'bg-kpi-solar',  badge: 'bg-kpi-solar/15 text-kpi-solar border-kpi-solar' },
  offline: { label: 'Offline', dot: 'bg-muted-foreground/40',    badge: 'bg-muted text-muted-foreground border-border' },
};

// ---------------------------------------------------------------------------
// Per-user deterministic colour accent
// ---------------------------------------------------------------------------

const TILE_ACCENTS = [
  'border-l-sky-400', 'border-l-violet-400', 'border-l-teal-400', 'border-l-rose-400',
  'border-l-amber-400', 'border-l-indigo-400', 'border-l-emerald-400', 'border-l-pink-400',
];

const AVATAR_COLORS = [
  'bg-info', 'bg-kpi-ro', 'bg-primary', 'bg-danger',
  'bg-warn', 'bg-kpi-ro', 'bg-accent', 'bg-danger',
];

const PLANT_COLUMN_ACCENTS = [
  { header: 'from-info to-info',      border: 'border-info',   bg: 'bg-info-soft',    text: 'text-info',    line: '#0ea5e9' },
  { header: 'from-primary to-primary',    border: 'border-primary',  bg: 'bg-primary-soft',   text: 'text-primary',   line: '#14b8a6' },
  { header: 'from-highlight to-highlight',    border: 'border-highlight',  bg: 'bg-highlight-soft',   text: 'text-highlight',   line: '#06b6d4' },
  { header: 'from-info to-primary',     border: 'border-info',   bg: 'bg-info-soft',   text: 'text-info',    line: '#0369a1' },
  { header: 'from-primary to-highlight',    border: 'border-primary',  bg: 'bg-primary-soft',  text: 'text-primary',   line: '#0f766e' },
  { header: 'from-highlight to-info',     border: 'border-highlight',  bg: 'bg-highlight-soft',  text: 'text-highlight',   line: '#0e7490' },
];

const DEPTH_SHADES = [
  'bg-white',
  'bg-info-soft/80',
  'bg-info-soft/70',
  'bg-primary-soft/80',
  'bg-primary-soft/70',
  'bg-highlight-soft/80',
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
  { role: 'Admin',         level: 0, icon: <Crown className="h-3 w-3" />,        color: 'text-danger',    bg: 'bg-danger-soft border-danger' },
  { role: 'Manager',       level: 1, icon: <Briefcase className="h-3 w-3" />,    color: 'text-info',     bg: 'bg-info-soft border-info' },
  { role: 'Data Analyst',  level: 2, icon: <BarChart2 className="h-3 w-3" />,    color: 'text-kpi-ro',  bg: 'bg-kpi-ro/15 border-kpi-ro' },
  { role: 'Technician',    level: 3, icon: <Cog className="h-3 w-3" />,          color: 'text-primary',    bg: 'bg-primary-soft border-primary' },
  { role: 'Operator',      level: 4, icon: <UserCircle className="h-3 w-3" />,   color: 'text-muted-foreground',    bg: 'bg-muted border-border' },
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
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse"
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
    ? <CheckCheck className="h-2.5 w-2.5 text-info shrink-0" />
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
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gradient-to-r from-info to-primary text-white shrink-0">
        <div className="relative shrink-0">
          <div className={cn('h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold', avatarColor(peer.id))}>
            {initials(peer)}
          </div>
          <span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-info', pc.dot)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate leading-tight">{fullName(peer)}</div>
          <div className="text-2xs opacity-75 leading-tight">
            {peerTyping ? (
              <span className="animate-pulse">typing…</span>
            ) : (
              <span>{pc.label} · @{peer.username ?? '—'}</span>
            )}
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6 text-white hover:bg-white/20 shrink-0" aria-label="Close" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-warn-soft border-b border-warn text-warn text-2xs shrink-0">
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
                      ? 'bg-info text-white rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm',
                  )}>
                    {m.body}
                  </div>
                  <div className="flex items-center gap-1 text-3xs text-muted-foreground px-1">
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
                  <span className="text-3xs text-muted-foreground px-1">{peer.first_name ?? peer.username} is typing…</span>
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
          aria-label={sending ? 'Sending message' : 'Send message'}
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
        <div className="text-2xs text-muted-foreground uppercase tracking-wide">{label}</div>
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
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Close" onClick={onClose}>
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
      className="relative bg-card rounded-xl border p-3 flex flex-col items-center gap-1.5 hover:shadow-md transition-all cursor-pointer group hover:border-info/90"
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
          {isSelf && <span className="ml-1 text-3xs text-muted-foreground">(you)</span>}
        </div>
        <div className={cn('inline-flex items-center gap-0.5 mt-0.5 text-3xs font-medium px-1.5 py-0.5 rounded-full border', rc.bg, rc.color)}>
          {rc.icon}
          <span>{memberRole}</span>
        </div>
      </div>

      {/* Status + Chat */}
      <div className="flex items-center gap-1.5 w-full justify-center">
        <span className={cn('text-3xs px-1.5 py-0.5 rounded-full border font-medium', pc.badge)}>{pc.label}</span>
        {!isSelf && (
          <button
            className="h-5 w-5 flex items-center justify-center rounded-full bg-info-soft text-info hover:bg-info-soft transition-colors shrink-0"
            onClick={(e) => { e.stopPropagation(); onChat(); }}
            title="Chat"
            aria-label="Chat"
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
      const { data } = await (supabase as any).from('user_profiles').select('id, user_roles(role)');
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
          <span className="text-2xs text-muted-foreground whitespace-nowrap">
            <span className="text-accent font-semibold">{onlineCount}</span> active · {filteredStaff.length} shown
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
        <div className={cn('h-6 w-6 rounded-full flex items-center justify-center text-3xs font-bold text-white shrink-0', avatarColor(member.id))}>
          {initials(member)}
        </div>

        {/* Name + role */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold leading-snug truncate">{fullName(member)}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <span
              className={cn('inline-flex items-center gap-0.5 text-3xs font-medium px-1 py-0.5 rounded border', rc.bg, rc.color)}
            >
              {rc.icon}
              <span>{memberRole}</span>
            </span>
            {member.designation && (
              <span className="text-3xs text-muted-foreground truncate max-w-[72px]">{member.designation}</span>
            )}
          </div>
        </div>

        {hasChildren && (
          <span
            className="text-3xs font-bold px-1 rounded shrink-0"
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
          <span className={cn('inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full border', r.bg, r.color)}>
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
              className={cn('flex items-center gap-1.5 text-2xs font-semibold px-2.5 py-1 rounded-full border', accent.bg, accent.border, accent.text)}
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
                  <span className="text-xs font-bold uppercase tracking-wide truncate flex-1">{plant.name}</span>
                  <span className="text-2xs font-semibold opacity-80 bg-white/20 px-1.5 py-0.5 rounded-full">
                    {plantStaff.length}
                  </span>
                </div>
              </div>

              {/* Tree nodes — fully expanded */}
              <div className={cn('flex-1 p-2 space-y-0.5 overflow-y-auto', accent.bg)} style={{ maxHeight: 380 }}>
                {roots.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center">No hierarchy configured.</p>
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
// KPI Tab v3 — Team Coverage + Individual Activity
//
// Two lenses over the same underlying reading data:
//   • Team Coverage (default) — was each well/locator/train/meter logged by
//     ANYONE (including automated/telemetry rows with no recorded_by) on a
//     given day, at the plant level? Answers "is the plant being monitored?"
//     and isn't affected by how many operators split the work.
//   • Individual Activity — per-operator view, scored against the FULL
//     plant target (this is the v2 behaviour). Useful for seeing who's
//     logging what, but on a multi-operator plant nobody is "expected" to
//     single-handedly hit 100% unless duties genuinely aren't split.
// ---------------------------------------------------------------------------

type KpiRange2 = 'today' | 7 | 14 | 30;
type KpiViewMode = 'team' | 'individual';

// Each input type column definition
const INPUT_COLS = [
  { key: 'wells',         label: 'Wells',       full: 'Wells Reading',    color: '#0ea5e9' },
  { key: 'locator',       label: 'Locator',     full: 'Locator Reading',  color: '#14b8a6' },
  { key: 'ro_train',      label: 'RO Train',    full: 'RO Train (hourly)',color: '#8b5cf6' },
  { key: 'product_meter', label: 'Prod. Meter', full: 'Product Meter',    color: '#f59e0b' },
  { key: 'solar',         label: 'Solar',       full: 'Solar Reading',    color: '#f97316' },
  { key: 'grid',          label: 'Grid',        full: 'Grid Reading',     color: '#64748b' },
  { key: 'chemicals',     label: 'Chemicals',   full: 'Chemical Dosing',  color: '#10b981' },
] as const;

type InputColKey = typeof INPUT_COLS[number]['key'];

// Compliance 0–1 (null = N/A for this plant/type combination)
type DayScore2 = number | null;
type ScoreMap2 = Record<string, DayScore2>;                       // dayStr → score
type EntityTypeScore = Partial<Record<InputColKey, ScoreMap2>>;   // inputKey → ScoreMap
type ScoreMatrix = Record<string, EntityTypeScore>;               // key → scores

// How many RO Train readings are expected per train per day. Reads
// `plant.ro_hourly_target` if a plant row has one set (future-proofing for a
// per-plant cadence, once that column exists); otherwise falls back to the
// default below. Verify this against your actual SOP — hourly (24/day) is a
// strict bar, and if real practice is e.g. every 2–4h the default should be
// lowered or made configurable per plant.
const DEFAULT_RO_HOURLY_TARGET = 24;
function roTargetForPlant(plant: { ro_hourly_target?: number | string | null } | null | undefined): number {
  const v = Number(plant?.ro_hourly_target);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RO_HOURLY_TARGET;
}

const KPI_STATUS = {
  complete: { color: '#22c55e', label: 'Complete' },
  partial:  { color: '#eab308', label: 'Partial'  },
  minimal:  { color: '#f97316', label: 'Minimal'  },
  missed:   { color: '#ef4444', label: 'Missed'   },
  pending:  { color: '#38bdf8', label: 'Pending (today)' },
  na:       { color: '#e5e7eb', label: 'N/A'      },
} as const;

// A cell for the CURRENT day with a score of exactly 0 reads as "Pending",
// not "Missed" — the day isn't over yet, so we genuinely can't call it a
// miss. Past days keep the original complete/partial/minimal/missed logic.
function scoreStatus(s: DayScore2, isToday = false): keyof typeof KPI_STATUS {
  if (s === null) return 'na';
  if (isToday && s === 0) return 'pending';
  if (s >= 1.0)  return 'complete';
  if (s >= 0.5)  return 'partial';
  if (s > 0)     return 'minimal';
  return 'missed';
}
function scoreColor(s: DayScore2, isToday = false) { return KPI_STATUS[scoreStatus(s, isToday)].color; }

function generateDays2(range: KpiRange2): string[] {
  if (range === 'today') {
    return [new Date().toISOString().slice(0, 10)];
  }
  const days: string[] = [];
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// ── Mini heatmap cell ────────────────────────────────────────────────────────

function MiniHeatmap({ scores, days, label, todayStr, onHover }: {
  scores: ScoreMap2;
  days: string[];
  label: string;
  todayStr: string;
  onHover: (text: string | null, e?: React.MouseEvent) => void;
}) {
  const isSingleDay = days.length === 1;

  if (isSingleDay) {
    const day = days[0];
    const score = scores[day] ?? 0;
    const isToday = day === todayStr;
    const status = scoreStatus(score, isToday);
    const pct = score === null ? null : Math.round((score as number) * 100);
    const color = scoreColor(score, isToday);

    return (
      <div className="flex items-center justify-center py-1">
        <div
          className="flex items-center justify-center rounded-md font-bold text-2xs text-white cursor-default select-none transition-transform hover:scale-105"
          style={{ background: color, width: 44, height: 22, opacity: status === 'na' ? 0.5 : 1 }}
          onMouseEnter={(e) => onHover(
            status === 'na' ? `${label}\nNot applicable`
              : status === 'pending' ? `${label} — ${day}\n⏳ Pending — day in progress`
              : `${label} — ${day}\n${pct === 100 ? '✓ Complete' : pct === 0 ? '✗ Missed' : pct + '% done'}`,
            e
          )}
          onMouseLeave={() => onHover(null)}
        >
          {status === 'na' ? '—' : status === 'pending' ? '…' : pct === 100 ? '✓' : pct === 0 ? '✗' : `${pct}%`}
        </div>
      </div>
    );
  }

  const sqSize = days.length <= 7 ? 13 : days.length <= 14 ? 9 : 6;

  return (
    <div className="flex items-center gap-px px-1.5 py-1.5">
      {days.map((day) => {
        const raw = scores[day];
        const score: DayScore2 = raw === undefined ? 0 : raw;
        const isToday = day === todayStr;
        const status = scoreStatus(score, isToday);
        const pct = score === null ? null : Math.round((score as number) * 100);
        return (
          <div
            key={day}
            style={{ width: sqSize, height: sqSize, background: scoreColor(score, isToday), borderRadius: 2, flexShrink: 0, opacity: status === 'na' ? 0.25 : 0.88 }}
            onMouseEnter={(e) => onHover(`${label} — ${day}\n${status === 'na' ? 'N/A' : status === 'pending' ? 'Pending — day in progress' : pct + '% complete'}`, e)}
            onMouseLeave={() => onHover(null)}
          />
        );
      })}
    </div>
  );
}

// ── Legend ───────────────────────────────────────────────────────────────────

function KpiLegend2() {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-2xs text-muted-foreground font-semibold">Legend:</span>
      {Object.entries(KPI_STATUS).map(([key, cfg]) => (
        <div key={key} className="flex items-center gap-1">
          <div className="h-3 w-3 rounded-sm" style={{ background: cfg.color }} />
          <span className="text-2xs text-muted-foreground">{cfg.label}</span>
        </div>
      ))}
    </div>
  );
}

function KpiTab({ staff, roles, plants }: { staff: StaffMember[]; roles: any[]; plants: any[] }) {
  const [searchParams] = useSearchParams();
  const [range, setRange] = useState<KpiRange2>('today');
  const [viewMode, setViewMode] = useState<KpiViewMode>(
    () => (searchParams.get('view') === 'individual' ? 'individual' : 'team'),
  );
  // Deep-link support: /employees?tab=kpi&view=individual&plant=<id> lands
  // straight on that plant's operator breakdown, pre-expanded — used by the
  // Data Completeness Radar's "see who's logging" link on the Dashboard.
  const [expandedPlants, setExpandedPlants] = useState<Set<string>>(() => {
    const plantId = searchParams.get('plant');
    return plantId ? new Set([plantId]) : new Set();
  });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const days = useMemo(() => generateDays2(range), [range, refreshKey]);
  const since = useMemo(() => days[0] + 'T00:00:00Z', [days]);
  // Every reading is bucketed into a UTC calendar day elsewhere in this file
  // (`.slice(0, 10)` on an ISO timestamp), so "today" and the elapsed-hours
  // proration below stay in UTC to match those buckets. If plants need a
  // local-timezone cutover instead, that has to change together with the
  // bucketing logic below — not just here.
  // Cheap to compute, so no useMemo — they naturally refresh on every
  // render (including a manual "Refresh" click) without needing a
  // refreshKey-only dependency array.
  const todayStr = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const elapsedFraction = Math.min(1, Math.max(0, (now.getUTCHours() + now.getUTCMinutes() / 60) / 24));

  // ── Operators only ─────────────────────────────────────────────────────────
  const operators = useMemo(() => {
    const opIds = new Set(
      (roles as any[]).filter((r) => r.role === 'Operator').map((r) => r.user_id)
    );
    return staff.filter((s) => opIds.has(s.id) && s.status === 'Active');
  }, [staff, roles]);

  const plantsWithOps = useMemo(() =>
    plants.filter((p) => operators.some((op) => op.plant_assignments?.includes(p.id))),
    [plants, operators]
  );

  const plantFlags = useMemo(() => {
    const m: Record<string, { has_solar: boolean; has_grid: boolean }> = {};
    plants.forEach((p) => {
      m[p.id] = { has_solar: (p as any).has_solar ?? false, has_grid: (p as any).has_grid ?? true };
    });
    return m;
  }, [plants]);

  const plantById = useMemo(() => {
    const m: Record<string, { ro_hourly_target?: number | string | null }> = {};
    plants.forEach((p) => { m[p.id] = p; });
    return m;
  }, [plants]);

  // ── Plant config queries ───────────────────────────────────────────────────
  // Wells & Product Meters now match the filtering already used for
  // Locators/RO Trains below: decommissioned/inactive assets are excluded
  // from the denominator, so a plant with retired equipment can still reach
  // 100% instead of being capped below it forever.

  const { data: wellsCfg = [] } = useQuery({
    queryKey: ['kpi-cfg-wells'],
    queryFn: async () => {
      const { data } = await supabase.from('wells').select('id, plant_id, status');
      return (data ?? []) as { id: string; plant_id: string; status: string }[];
    },
    staleTime: 10 * 60_000,
  });

  const { data: locatorsCfg = [] } = useQuery({
    queryKey: ['kpi-cfg-locators'],
    queryFn: async () => {
      const { data } = await supabase.from('locators').select('id, plant_id, status');
      return (data ?? []) as { id: string; plant_id: string; status: string }[];
    },
    staleTime: 10 * 60_000,
  });

  const { data: trainsCfg = [] } = useQuery({
    queryKey: ['kpi-cfg-trains'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('ro_trains').select('id, plant_id, status');
      return (data ?? []) as { id: string; plant_id: string; status: string }[];
    },
    staleTime: 10 * 60_000,
  });

  const { data: metersCfg = [] } = useQuery({
    queryKey: ['kpi-cfg-meters'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('product_meters').select('id, plant_id, status');
      return (data ?? []) as { id: string; plant_id: string; status: string }[];
    },
    staleTime: 10 * 60_000,
  });

  const wellsPerPlant    = useMemo(() => { const m: Record<string,number> = {}; wellsCfg.filter(w => w.status === 'Active').forEach(w => { m[w.plant_id] = (m[w.plant_id] ?? 0) + 1; }); return m; }, [wellsCfg]);
  const locatorsPerPlant = useMemo(() => { const m: Record<string,number> = {}; locatorsCfg.filter(l => l.status === 'Active').forEach(l => { m[l.plant_id] = (m[l.plant_id] ?? 0) + 1; }); return m; }, [locatorsCfg]);
  const trainsPerPlant   = useMemo(() => { const m: Record<string,string[]> = {}; trainsCfg.filter(t => t.status !== 'Offline').forEach(t => { (m[t.plant_id] = m[t.plant_id] ?? []).push(t.id); }); return m; }, [trainsCfg]);
  const metersPerPlant   = useMemo(() => { const m: Record<string,number> = {}; metersCfg.filter(x => x.status === 'Active').forEach(x => { m[x.plant_id] = (m[x.plant_id] ?? 0) + 1; }); return m; }, [metersCfg]);

  // ── Reading queries ────────────────────────────────────────────────────────

  const { data: wellReadings = [], isLoading: l1, error: e1, refetch: r1 } = useQuery({
    queryKey: ['kpi-r-wells', since, refreshKey],
    queryFn: async () => {
      const { data } = await supabase.from('well_readings')
        .select('plant_id, well_id, reading_datetime, recorded_by').gte('reading_datetime', since);
      return (data ?? []) as { plant_id: string; well_id: string; reading_datetime: string; recorded_by: string | null }[];
    },
    staleTime: 3 * 60_000,
  });

  const { data: locReadings = [], isLoading: l2, error: e2, refetch: r2 } = useQuery({
    queryKey: ['kpi-r-loc', since, refreshKey],
    queryFn: async () => {
      const { data } = await supabase.from('locator_readings')
        .select('plant_id, locator_id, reading_datetime, recorded_by').gte('reading_datetime', since);
      return (data ?? []) as { plant_id: string; locator_id: string; reading_datetime: string; recorded_by: string | null }[];
    },
    staleTime: 3 * 60_000,
  });

  const { data: roReadings = [], isLoading: l3, error: e3, refetch: r3 } = useQuery({
    queryKey: ['kpi-r-ro', since, refreshKey],
    queryFn: async () => {
      const { data } = await (supabase as any).from('ro_train_readings')
        .select('plant_id, train_id, reading_datetime, recorded_by').gte('reading_datetime', since);
      return (data ?? []) as { plant_id: string; train_id: string; reading_datetime: string; recorded_by: string | null }[];
    },
    staleTime: 3 * 60_000,
  });

  const { data: meterReadings = [], isLoading: l4, error: e4, refetch: r4 } = useQuery({
    queryKey: ['kpi-r-meter', since, refreshKey],
    queryFn: async () => {
      const { data } = await (supabase as any).from('product_meter_readings')
        .select('plant_id, meter_id, reading_datetime, recorded_by').gte('reading_datetime', since);
      return (data ?? []) as { plant_id: string; meter_id: string; reading_datetime: string; recorded_by: string | null }[];
    },
    staleTime: 3 * 60_000,
  });

  const { data: powerReadings = [], isLoading: l5, error: e5, refetch: r5 } = useQuery({
    queryKey: ['kpi-r-power', since, refreshKey],
    queryFn: async () => {
      const { data } = await supabase.from('power_readings')
        .select('plant_id, reading_datetime, recorded_by, daily_solar_kwh, daily_grid_kwh')
        .gte('reading_datetime', since);
      return (data ?? []) as { plant_id: string; reading_datetime: string; recorded_by: string | null; daily_solar_kwh: number | null; daily_grid_kwh: number | null }[];
    },
    staleTime: 3 * 60_000,
  });

  const { data: chemReadings = [], isLoading: l6, error: e6, refetch: r6 } = useQuery({
    queryKey: ['kpi-r-chem', since, refreshKey],
    queryFn: async () => {
      const { data } = await supabase.from('chemical_dosing_logs')
        .select('plant_id, log_datetime, recorded_by').gte('log_datetime', since);
      return (data ?? []) as { plant_id: string; log_datetime: string; recorded_by: string | null }[];
    },
    staleTime: 3 * 60_000,
  });

  const isLoading = l1 || l2 || l3 || l4 || l5 || l6;
  const kpiError = e1 || e2 || e3 || e4 || e5 || e6;
  const retryKpiQueries = () => { r1(); r2(); r3(); r4(); r5(); r6(); };

  // ── Matrices ────────────────────────────────────────────────────────────────
  // Built in a single pass over each reading array: `individual` keeps the
  // v2 per-operator behaviour (now with status-filtered denominators plus
  // today-pending/RO-proration) and `teamCoverage` is new — attribution-
  // agnostic, so telemetry/system rows with no recorded_by still count
  // toward "was this asset read today" instead of being silently dropped.

  const { individual, teamCoverage } = useMemo(() => {
    const indiv: ScoreMatrix = {};
    const team: ScoreMatrix = {};
    const daySet = new Set(days);

    // op:plant:day → Set/count   (individual — requires recorded_by)
    const wellMap:  Record<string, Set<string>> = {};
    const locMap:   Record<string, Set<string>> = {};
    const roMap:    Record<string, number>       = {};
    const meterMap: Record<string, Set<string>> = {};
    const solarMap: Record<string, number>       = {};
    const gridMap:  Record<string, number>       = {};
    const chemMap:  Record<string, number>       = {};

    // plant:day → Set/count   (team coverage — attribution-agnostic)
    const twellMap:  Record<string, Set<string>> = {};
    const tlocMap:   Record<string, Set<string>> = {};
    const troMap:    Record<string, number>       = {};
    const tmeterMap: Record<string, Set<string>> = {};
    const tsolarMap: Record<string, number>       = {};
    const tgridMap:  Record<string, number>       = {};
    const tchemMap:  Record<string, number>       = {};

    wellReadings.forEach((r) => {
      const day = r.reading_datetime.slice(0, 10);
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      (twellMap[tk] = twellMap[tk] ?? new Set()).add(r.well_id);
      if (!r.recorded_by) return;
      const k = `${r.recorded_by}:${r.plant_id}:${day}`;
      (wellMap[k] = wellMap[k] ?? new Set()).add(r.well_id);
    });

    locReadings.forEach((r) => {
      const day = r.reading_datetime.slice(0, 10);
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      (tlocMap[tk] = tlocMap[tk] ?? new Set()).add(r.locator_id);
      if (!r.recorded_by) return;
      const k = `${r.recorded_by}:${r.plant_id}:${day}`;
      (locMap[k] = locMap[k] ?? new Set()).add(r.locator_id);
    });

    roReadings.forEach((r) => {
      const day = r.reading_datetime.slice(0, 10);
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}:${r.train_id}`;
      troMap[tk] = (troMap[tk] ?? 0) + 1;
      if (!r.recorded_by) return;
      const k = `${r.recorded_by}:${r.plant_id}:${day}:${r.train_id}`;
      roMap[k] = (roMap[k] ?? 0) + 1;
    });

    meterReadings.forEach((r) => {
      const day = r.reading_datetime.slice(0, 10);
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      (tmeterMap[tk] = tmeterMap[tk] ?? new Set()).add(r.meter_id);
      if (!r.recorded_by) return;
      const k = `${r.recorded_by}:${r.plant_id}:${day}`;
      (meterMap[k] = meterMap[k] ?? new Set()).add(r.meter_id);
    });

    powerReadings.forEach((r) => {
      const day = r.reading_datetime.slice(0, 10);
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      if (r.daily_solar_kwh !== null) tsolarMap[tk] = (tsolarMap[tk] ?? 0) + 1;
      if (r.daily_grid_kwh  !== null) tgridMap[tk]  = (tgridMap[tk]  ?? 0) + 1;
      if (!r.recorded_by) return;
      const k = `${r.recorded_by}:${r.plant_id}:${day}`;
      if (r.daily_solar_kwh !== null) solarMap[k] = (solarMap[k] ?? 0) + 1;
      if (r.daily_grid_kwh  !== null) gridMap[k]  = (gridMap[k]  ?? 0) + 1;
    });

    chemReadings.forEach((r) => {
      const day = r.log_datetime.slice(0, 10);
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      tchemMap[tk] = (tchemMap[tk] ?? 0) + 1;
      if (!r.recorded_by) return;
      const k = `${r.recorded_by}:${r.plant_id}:${day}`;
      chemMap[k] = (chemMap[k] ?? 0) + 1;
    });

    // ── Team coverage: one entry per plant ──
    plantsWithOps.forEach((plant) => {
      const plantId = plant.id;
      const numWells  = wellsPerPlant[plantId]    ?? 0;
      const numLocs   = locatorsPerPlant[plantId] ?? 0;
      const trainIds  = trainsPerPlant[plantId]   ?? [];
      const numMeters = metersPerPlant[plantId]   ?? 0;
      const hasSolar  = plantFlags[plantId]?.has_solar ?? false;
      const hasGrid   = plantFlags[plantId]?.has_grid  ?? true;
      const roTarget  = roTargetForPlant(plant);

      const ts: EntityTypeScore = { wells: {}, locator: {}, ro_train: {}, product_meter: {}, solar: {}, grid: {}, chemicals: {} };

      days.forEach((day) => {
        const isToday = day === todayStr;
        const tk = `${plantId}:${day}`;

        ts.wells![day]   = numWells  === 0 ? null : Math.min(1, (twellMap[tk]?.size  ?? 0) / numWells);
        ts.locator![day] = numLocs   === 0 ? null : Math.min(1, (tlocMap[tk]?.size   ?? 0) / numLocs);

        if (trainIds.length === 0) {
          ts.ro_train![day] = null;
        } else {
          const target = isToday ? Math.max(1, Math.ceil(roTarget * elapsedFraction)) : roTarget;
          const perTrain = trainIds.map((tid) => Math.min(1, (troMap[`${tk}:${tid}`] ?? 0) / target));
          ts.ro_train![day] = perTrain.reduce((a, b) => a + b, 0) / perTrain.length;
        }

        ts.product_meter![day] = numMeters === 0 ? null : Math.min(1, (tmeterMap[tk]?.size ?? 0) / numMeters);
        ts.solar![day] = !hasSolar ? null : (tsolarMap[tk] ?? 0) >= 1 ? 1 : 0;
        ts.grid![day]  = !hasGrid  ? null : (tgridMap[tk]  ?? 0) >= 1 ? 1 : 0;
        ts.chemicals![day] = (tchemMap[tk] ?? 0) >= 1 ? 1 : 0;
      });

      team[plantId] = ts;
    });

    // ── Individual activity: one entry per operator × plant, still scored
    //    against the FULL plant target (unchanged philosophy — see the info
    //    banner and chat discussion for the caveat this carries) ──
    operators.forEach((op) => {
      (op.plant_assignments ?? []).forEach((plantId) => {
        const matKey = `${op.id}:${plantId}`;
        const plant = plantById[plantId];
        const numWells  = wellsPerPlant[plantId]    ?? 0;
        const numLocs   = locatorsPerPlant[plantId] ?? 0;
        const trainIds  = trainsPerPlant[plantId]   ?? [];
        const numMeters = metersPerPlant[plantId]   ?? 0;
        const hasSolar  = plantFlags[plantId]?.has_solar ?? false;
        const hasGrid   = plantFlags[plantId]?.has_grid  ?? true;
        const roTarget  = roTargetForPlant(plant);

        const ts: EntityTypeScore = { wells: {}, locator: {}, ro_train: {}, product_meter: {}, solar: {}, grid: {}, chemicals: {} };

        days.forEach((day) => {
          const isToday = day === todayStr;
          const k = `${op.id}:${plantId}:${day}`;

          ts.wells![day]   = numWells  === 0 ? null : Math.min(1, (wellMap[k]?.size  ?? 0) / numWells);
          ts.locator![day] = numLocs   === 0 ? null : Math.min(1, (locMap[k]?.size   ?? 0) / numLocs);

          if (trainIds.length === 0) {
            ts.ro_train![day] = null;
          } else {
            const target = isToday ? Math.max(1, Math.ceil(roTarget * elapsedFraction)) : roTarget;
            const perTrain = trainIds.map((tid) => Math.min(1, (roMap[`${k}:${tid}`] ?? 0) / target));
            ts.ro_train![day] = perTrain.reduce((a, b) => a + b, 0) / perTrain.length;
          }

          ts.product_meter![day] = numMeters === 0 ? null : Math.min(1, (meterMap[k]?.size ?? 0) / numMeters);
          ts.solar![day] = !hasSolar ? null : (solarMap[k] ?? 0) >= 1 ? 1 : 0;
          ts.grid![day]  = !hasGrid  ? null : (gridMap[k]  ?? 0) >= 1 ? 1 : 0;
          ts.chemicals![day] = (chemMap[k] ?? 0) >= 1 ? 1 : 0;
        });

        indiv[matKey] = ts;
      });
    });

    return { individual: indiv, teamCoverage: team };
  }, [operators, plantsWithOps, days, todayStr, elapsedFraction, wellsPerPlant, locatorsPerPlant, trainsPerPlant, metersPerPlant, plantFlags, plantById,
      wellReadings, locReadings, roReadings, meterReadings, powerReadings, chemReadings]);

  const activeMatrix = viewMode === 'team' ? teamCoverage : individual;

  // ── Summary ────────────────────────────────────────────────────────────────
  // "Pending" cells (today, score 0) count toward neither complete nor
  // missed — the day isn't over, so it's genuinely unknown yet — but are
  // reported separately so they're not just invisible.

  const summary = useMemo(() => {
    let total = 0, complete = 0, missed = 0, pending = 0;
    Object.values(activeMatrix).forEach((ts) =>
      Object.values(ts).forEach((dm) =>
        Object.entries(dm as ScoreMap2).forEach(([day, s]) => {
          if (s === null) return;
          const isToday = day === todayStr;
          if (isToday && s === 0) { pending++; return; }
          total++;
          if ((s as number) >= 1) complete++;
          if ((s as number) === 0) missed++;
        })
      )
    );
    return { pct: total > 0 ? Math.round((complete / total) * 100) : 0, complete, total, missed, pending };
  }, [activeMatrix, todayStr]);

  const togglePlant = useCallback((id: string) => {
    setExpandedPlants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const onHover = useCallback((text: string | null, e?: React.MouseEvent) => {
    setTooltip(text && e ? { x: e.clientX, y: e.clientY, text } : null);
  }, []);

  const RANGES: { label: string; value: KpiRange2 }[] = [
    { label: 'Today', value: 'today' },
    { label: '7D',    value: 7 },
    { label: '14D',   value: 14 },
    { label: '30D',   value: 30 },
  ];

  return (
    <div className="space-y-3">

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border overflow-hidden">
          {RANGES.map(({ label, value }) => (
            <button key={String(value)}
              className={cn('px-3 py-1.5 text-xs font-medium transition-colors',
                range === value ? 'bg-info text-white' : 'hover:bg-muted')}
              onClick={() => setRange(value)}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg border overflow-hidden">
          <button
            className={cn('flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors',
              viewMode === 'team' ? 'bg-kpi-ro text-white' : 'hover:bg-muted')}
            onClick={() => setViewMode('team')}>
            <Building2 className="h-3 w-3" /> Team Coverage
          </button>
          <button
            className={cn('flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors',
              viewMode === 'individual' ? 'bg-kpi-ro text-white' : 'hover:bg-muted')}
            onClick={() => setViewMode('individual')}>
            <User className="h-3 w-3" /> Individual Activity
          </button>
        </div>

        <div className="text-xs text-muted-foreground">
          {viewMode === 'team' ? (
            <><span className="font-semibold text-foreground">{plantsWithOps.length}</span> plants ·{' '}</>
          ) : (
            <><span className="font-semibold text-foreground">{operators.length}</span> operators ·{' '}</>
          )}
          <span className={cn('font-semibold',
            summary.pct >= 80 ? 'text-accent' : summary.pct >= 50 ? 'text-warn' : 'text-danger')}>
            {summary.pct}%
          </span>{' '}{viewMode === 'team' ? 'covered' : 'logged (of full plant target)'}
        </div>

        <div className="flex-1" />
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
          onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
      </div>

      {/* Legend */}
      <KpiLegend2 />

      {/* Info banner */}
      <div className="flex items-start gap-2 bg-info-soft border border-info rounded-lg px-3 py-2 text-xs text-info">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          {viewMode === 'team' ? (
            <><strong>Team Coverage.</strong> Was each asset logged by <em>anyone</em> that day — operator or automated feed? This is the plant-level "is it being monitored" view and isn't affected by how work is split across operators.</>
          ) : (
            <><strong>Individual Activity.</strong> Each operator is scored against the plant's <em>full</em> daily target — on plants with several operators sharing the round, nobody is expected to single-handedly reach 100% unless duties aren't actually split. Use Team Coverage for the "is it getting done" answer.</>
          )}
          {' '}Targets per day: Wells ≥1/well · Locator ≥1/locator (pre-treatment &amp; RO) · RO Train {DEFAULT_RO_HOURLY_TARGET}/train (prorated by elapsed hours for today — verify against actual SOP) · Prod. Meter ≥1/meter · Solar/Grid ≥1 if applicable · Chemicals ≥1 log.
          {' '}Today's cells read <strong>Pending</strong>, not Missed, until the day ends.
          {viewMode === 'individual' && ' Click a plant row to expand its operators.'}
          {range !== 'today' && ' Each cell is a day-by-day mini heatmap.'}
        </span>
      </div>

      {/* Matrix table */}
      <Card className="overflow-auto p-0">
        <DataState
          loading={isLoading}
          error={kpiError}
          isEmpty={plantsWithOps.length === 0}
          emptyTitle="No operators assigned to any plant."
          onRetry={retryKpiQueries}
        >
          <table className="w-full border-collapse text-xs">
            {/* Column headers */}
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-semibold text-xs sticky left-0 bg-muted/50 z-10 min-w-[148px] max-w-[148px]">
                  {viewMode === 'team' ? 'Plant' : 'Operator'}
                </th>
                {INPUT_COLS.map((col) => (
                  <th key={col.key} className="py-2 px-1 font-semibold text-center">
                    <span
                      className="inline-block px-2 py-0.5 rounded text-white text-3xs font-bold whitespace-nowrap"
                      style={{ background: col.color }}>
                      {col.label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {viewMode === 'team' ? (
                plantsWithOps.map((plant, pi) => {
                  const accent = PLANT_COLUMN_ACCENTS[pi % PLANT_COLUMN_ACCENTS.length];
                  const ts = teamCoverage[plant.id] ?? {};
                  return (
                    <tr key={`team:${plant.id}`} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-1 sticky left-0 z-10 bg-background"
                        style={{ borderLeft: `2px solid ${accent.line}` }}>
                        <div className="flex items-center gap-1.5">
                          <Building2 className={cn('h-3 w-3 shrink-0', accent.text)} />
                          <span className={cn('font-semibold text-xs', accent.text)}>{plant.name}</span>
                        </div>
                      </td>
                      {INPUT_COLS.map((col) => (
                        <td key={col.key} className="py-0 px-0 align-middle">
                          <MiniHeatmap
                            scores={(ts[col.key] ?? {}) as ScoreMap2}
                            days={days}
                            todayStr={todayStr}
                            label={`${plant.name} · ${col.full}`}
                            onHover={onHover}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })
              ) : (
                plantsWithOps.flatMap((plant, pi) => {
                  const accent = PLANT_COLUMN_ACCENTS[pi % PLANT_COLUMN_ACCENTS.length];
                  const plantOps = operators.filter((op) => op.plant_assignments?.includes(plant.id));
                  const isExpanded = expandedPlants.has(plant.id);
                  const rows: React.ReactNode[] = [];

                  // Plant header row (always visible)
                  rows.push(
                    <tr key={`ph:${plant.id}`}
                      className="border-b cursor-pointer select-none hover:bg-muted/40 transition-colors"
                      onClick={() => togglePlant(plant.id)}>
                      <td className="px-3 py-2 sticky left-0 z-10 bg-background"
                        style={{ borderLeft: `2px solid ${accent.line}` }}>
                        <div className="flex items-center gap-1.5">
                          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform shrink-0',
                            accent.text, isExpanded && 'rotate-90')} />
                          <Building2 className={cn('h-3 w-3 shrink-0', accent.text)} />
                          <span className={cn('font-semibold text-xs', accent.text)}>{plant.name}</span>
                          <span className="text-2xs text-muted-foreground">
                            ({plantOps.length})
                          </span>
                        </div>
                      </td>
                      {/* Plant aggregate summary dots — average of this plant's operators, individual lens */}
                      {INPUT_COLS.map((col) => {
                        const allDayScores = plantOps.flatMap((op) =>
                          days.map((d) => {
                            const s = individual[`${op.id}:${plant.id}`]?.[col.key]?.[d];
                            return s === undefined ? 0 : s;
                          })
                        ).filter((s): s is number => s !== null);
                        const avg = allDayScores.length > 0
                          ? allDayScores.reduce((a, b) => a + b, 0) / allDayScores.length
                          : null;
                        return (
                          <td key={col.key} className={cn('py-2 px-1 text-center', accent.bg)}>
                            <div className="flex items-center justify-center">
                              <div className="h-2.5 w-2.5 rounded-sm"
                                style={{ background: scoreColor(avg), opacity: 0.85 }} />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );

                  // Operator rows (only when expanded)
                  if (isExpanded) {
                    plantOps.forEach((op) => {
                      const matKey = `${op.id}:${plant.id}`;
                      const ts = individual[matKey] ?? {};
                      rows.push(
                        <tr key={`op:${matKey}`}
                          className="border-b hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-1 sticky left-0 z-10 bg-background pl-8"
                            style={{ borderLeft: `2px solid ${accent.line}` }}>
                            <div className="flex items-center gap-1.5">
                              <div className={cn('h-5 w-5 rounded-full flex items-center justify-center text-3xs font-bold text-white shrink-0', avatarColor(op.id))}>
                                {initials(op)}
                              </div>
                              <span className="text-xs font-medium truncate max-w-[90px] leading-tight">
                                {fullName(op)}
                              </span>
                            </div>
                          </td>
                          {INPUT_COLS.map((col) => (
                            <td key={col.key} className="py-0 px-0 align-middle">
                              <MiniHeatmap
                                scores={(ts[col.key] ?? {}) as ScoreMap2}
                                days={days}
                                todayStr={todayStr}
                                label={`${fullName(op)} · ${col.full}`}
                                onHover={onHover}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    });
                  }

                  return rows;
                })
              )}
            </tbody>
          </table>
        </DataState>
      </Card>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: viewMode === 'team' ? 'Coverage Rate' : 'Logging Rate', value: `${summary.pct}%`, color: summary.pct >= 80 ? 'text-accent' : summary.pct >= 50 ? 'text-warn' : 'text-danger' },
          { label: viewMode === 'team' ? 'Asset-Days Logged' : 'Cells Completed', value: `${summary.complete}/${summary.total}`, color: 'text-info' },
          { label: viewMode === 'team' ? 'Assets Missed' : 'Cells Missed', value: `${summary.missed}`, color: summary.missed === 0 ? 'text-accent' : 'text-danger' },
          { label: 'Pending Today', value: `${summary.pending}`, color: summary.pending === 0 ? 'text-muted-foreground' : 'text-info' },
        ].map((s) => (
          <div key={s.label} className="flex flex-col items-center bg-muted/40 rounded-lg py-3 px-2 text-center gap-0.5">
            <span className={cn('text-xl font-bold leading-none', s.color)}>{s.value}</span>
            <span className="text-2xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="fixed z-50 bg-popover text-popover-foreground border text-2xs rounded-lg px-2.5 py-2 shadow-[var(--shadow-elev)] pointer-events-none whitespace-pre leading-relaxed"
          style={{ left: tooltip.x + 12, top: tooltip.y - 12 }}>
          {tooltip.text}
        </div>
      )}
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
    { label: 'Total Staff', value: staff.length, icon: <Users className="h-4 w-4" />, color: 'text-info' },
    { label: 'Active', value: activeCount, icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-accent' },
    { label: 'Plants Covered', value: plantsCount, icon: <Building2 className="h-4 w-4" />, color: 'text-kpi-ro' },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {statItems.map((s) => (
          <div key={s.label} className="flex flex-col items-center bg-muted/50 rounded-lg py-3 px-2 text-center gap-1">
            <span className={s.color}>{s.icon}</span>
            <span className="text-xl font-bold leading-none">{s.value}</span>
            <span className="text-2xs text-muted-foreground">{s.label}</span>
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
        <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
        No pending approvals. All accounts are active.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {pending.map((s) => (
        <div key={s.id} className="flex items-center gap-3 bg-warn-soft border border-warn rounded-lg px-3 py-2">
          <div className={cn('h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0', avatarColor(s.id))}>
            {initials(s)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{fullName(s)}</div>
            <div className="text-xs text-muted-foreground">@{s.username ?? '—'} · {s.designation ?? 'No designation'}</div>
          </div>
          <Button
            size="sm" variant="outline"
            className="h-7 px-2 text-xs text-accent border-accent hover:bg-accent-soft shrink-0"
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
              <span className={cn('inline-flex items-center gap-1 font-semibold text-foreground w-28 shrink-0 text-2xs', color)}>
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
      if (next.has(i)) next.delete(i); else next.add(i);
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
      const { data } = await (supabase as any).from('user_profiles').select('id, user_roles(role)');
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
            <AlertCircle className="h-4 w-4 text-warn shrink-0" />
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
          <span className="text-2xs text-muted-foreground ml-1">by plant</span>
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
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useTabPersist<'staff' | 'kpi' | 'info'>('tab:employees', 'staff');

  // Deep link (e.g. from the Dashboard's Data Completeness Radar) should win
  // over whatever tab was last open in this session, not just the default.
  useEffect(() => {
    if (searchParams.get('tab') === 'kpi' && tab !== 'kpi') setTab('kpi');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
      const { data } = await (supabase as any).from('user_profiles').select('id, user_roles(role)');
      return (data ?? []).flatMap((p: any) =>
        (p.user_roles ?? []).map((r: any) => ({ user_id: p.id, role: r.role }))
      );
    },
  });

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader title="Employees" />
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
