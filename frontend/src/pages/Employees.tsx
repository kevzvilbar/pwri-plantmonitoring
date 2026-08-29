import React, { useCallback, useEffect, useRef, useState, useMemo, Fragment, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTabPersist } from '@/hooks/useTabPersist';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, X, Send, Loader2, Clock,
  Building2, User, ShieldCheck, MapPin, ChevronRight,
  Users, CheckCircle2, AlertCircle, BookOpen, ChevronDown,
  GitBranch, Check, CheckCheck,
  Search, BarChart2, ChevronLeft, Info,
  Crown, Briefcase, Cog, UserCircle,
  RefreshCw, ZoomIn, LayoutGrid, List, Layers, Filter, Download, FileDown, Award,
} from 'lucide-react';
import { BookReader } from '@/components/manual/BookReader';
import { BOOK_PARTS } from '@/components/manual/bookChapters';
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
import { fmtIsoDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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

const AVATAR_COLORS = [
  'bg-info', 'bg-kpi-ro', 'bg-primary', 'bg-danger',
  'bg-warn', 'bg-kpi-ro', 'bg-accent', 'bg-danger',
];

const PLANT_COLUMN_ACCENTS = [
  { header: 'from-info to-info',      border: 'border-info',   bg: 'bg-info-soft',    text: 'text-info',    line: 'hsl(var(--org-line-1))' },
  { header: 'from-primary to-primary',    border: 'border-primary',  bg: 'bg-primary-soft',   text: 'text-primary',   line: 'hsl(var(--org-line-2))' },
  { header: 'from-highlight to-highlight',    border: 'border-highlight',  bg: 'bg-highlight-soft',   text: 'text-highlight',   line: 'hsl(var(--org-line-3))' },
  { header: 'from-info to-primary',     border: 'border-info',   bg: 'bg-info-soft',   text: 'text-info',    line: 'hsl(var(--org-line-4))' },
  { header: 'from-primary to-highlight',    border: 'border-primary',  bg: 'bg-primary-soft',  text: 'text-primary',   line: 'hsl(var(--org-line-5))' },
  { header: 'from-highlight to-info',     border: 'border-highlight',  bg: 'bg-highlight-soft',  text: 'text-highlight',   line: 'hsl(var(--org-line-6))' },
];

const DEPTH_SHADES = [
  'bg-card',
  'bg-info-soft/80',
  'bg-info-soft/70',
  'bg-primary-soft/80',
  'bg-primary-soft/70',
  'bg-highlight-soft/80',
];

// Same 6-color set as PLANT_COLUMN_ACCENTS.line above — both read from the
// --org-line-* tokens instead of maintaining two independent hardcoded copies.
const CONNECTOR_COLORS = [
  'hsl(var(--org-line-1))', 'hsl(var(--org-line-2))', 'hsl(var(--org-line-3))',
  'hsl(var(--org-line-4))', 'hsl(var(--org-line-5))', 'hsl(var(--org-line-6))',
];

function hashId(id: string) {
  return id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
}

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
      <div
        className={cn(
          'fixed top-0 bottom-0 z-50 bg-background border-l shadow-2xl flex flex-col',
          // Full-width on mobile — this was a fixed 320px (w-80) drawer
          // regardless of viewport, which either exactly filled or didn't
          // quite fit a 320-375px phone with zero margin, and gave content
          // (multi-line info rows, action buttons) the same cramped width
          // it'd get on desktop. sm:w-80 restores the original sidebar
          // width once there's room for it to actually behave like one.
          'right-0 left-0 sm:left-auto sm:w-80',
        )}
      >
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

        {/* pb includes a safe-area inset so the action row clears the home
            indicator/gesture bar on notched phones when this is full-width. */}
        <div className="border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-2">
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
// Staff Card — Modern horizontal executive design
// ---------------------------------------------------------------------------

function StaffCard({ member, roles, plants, isSelf, onlineIds, onChat, onDetail }: {
  member: StaffMember; roles: any[]; plants: any[]; isSelf: boolean; onlineIds: Set<string>; onChat: () => void; onDetail: () => void;
}) {
  const presence = getPresence(member.updated_at, member.status, onlineIds.has(member.id));
  const pc = presenceConfig[presence];
  const memberRole = (roles as any[]).find((r) => r.user_id === member.id)?.role ?? 'Operator';
  const rc = getRoleConfig(memberRole);

  const assignedPlantNames = (member.plant_assignments ?? [])
    .map((pid) => plants.find((p) => p.id === pid)?.name)
    .filter(Boolean);

  return (
    <div
      className="bg-card hover:bg-card/90 rounded-xl border border-border/70 p-3.5 flex flex-col justify-between gap-3 shadow-2xs hover:shadow-md hover:border-primary/50 transition-all cursor-pointer group"
      onClick={onDetail}
    >
      {/* Top row: Avatar + Identity + Presence pill */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Avatar with live presence ring */}
          <div className="relative shrink-0">
            <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center text-xs font-bold text-white shadow-xs', avatarColor(member.id))}>
              {initials(member)}
            </div>
            <span className={cn('absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-card', pc.dot)} />
          </div>

          {/* Name & Role */}
          <div className="min-w-0 flex-1">
            <div className="font-bold text-xs leading-snug truncate flex items-center gap-1.5">
              <span className="truncate">{fullName(member)}</span>
              {isSelf && (
                <span className="text-[10px] font-semibold px-1 rounded bg-primary-soft text-primary">you</span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className={cn('inline-flex items-center gap-1 text-3xs font-semibold px-1.5 py-0.2 rounded-md border', rc.bg, rc.color)}>
                {rc.icon}
                <span>{memberRole}</span>
              </span>
              {member.username && (
                <span className="text-3xs text-muted-foreground truncate font-mono">@{member.username}</span>
              )}
            </div>
          </div>
        </div>

        {/* Presence Badge */}
        <span className={cn('text-3xs px-2 py-0.5 rounded-full border font-semibold shrink-0', pc.badge)}>
          {pc.label}
        </span>
      </div>

      {/* Plant Assignment & Action row */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40 text-xs">
        {/* Plant chips */}
        <div className="flex items-center gap-1 overflow-hidden">
          <MapPin className="h-3 w-3 text-muted-foreground/60 shrink-0" />
          {assignedPlantNames.length > 0 ? (
            <span className="text-3xs text-muted-foreground truncate font-medium">
              {assignedPlantNames.slice(0, 2).join(', ')}
              {assignedPlantNames.length > 2 && ` +${assignedPlantNames.length - 2}`}
            </span>
          ) : (
            <span className="text-3xs text-muted-foreground/50 italic">All plants / Float</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {!isSelf && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary-soft"
              onClick={onChat}
              title="Send direct message"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-3xs gap-0.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={onDetail}
            title="View employee profile"
          >
            <span>Profile</span>
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff tab
// ---------------------------------------------------------------------------

function Staff() {
  const { data: plants = [] } = usePlants();
  const { isAdmin, user, activeOperator } = useAuth();
  const queryClient = useQueryClient();

  const [chatPeer, setChatPeer] = useState<StaffMember | null>(null);
  const [detailMember, setDetailMember] = useState<StaffMember | null>(null);
  const [search, setSearch] = useState('');
  const [filterPlant, setFilterPlant] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | 'online' | 'leadership' | 'analyst' | 'operator'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table' | 'grouped'>('grid');

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

  // Calculate high-level stats
  const onlineCount = staff.filter((s) => onlineIds.has(s.id) || getPresence(s.updated_at, s.status, onlineIds.has(s.id)) === 'active').length;
  const leadershipCount = staff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r === 'Admin' || r === 'Manager';
  }).length;
  const analystCount = staff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r === 'Data Analyst';
  }).length;
  const operatorCount = staff.length - leadershipCount - analystCount;

  // Filter staff
  const filteredStaff = useMemo(() => {
    const q = search.toLowerCase();
    return staff.filter((s) => {
      const nameMatch = !q || fullName(s).toLowerCase().includes(q) || (s.username ?? '').toLowerCase().includes(q);
      const plantMatch = filterPlant === 'all' || s.plant_assignments?.includes(filterPlant);

      const r = (roles as any[]).find((x) => x.user_id === s.id)?.role ?? 'Operator';
      const isOnline = onlineIds.has(s.id) || getPresence(s.updated_at, s.status, onlineIds.has(s.id)) === 'active';

      let roleMatch = true;
      if (roleFilter === 'online') roleMatch = isOnline;
      else if (roleFilter === 'leadership') roleMatch = r === 'Admin' || r === 'Manager';
      else if (roleFilter === 'analyst') roleMatch = r === 'Data Analyst';
      else if (roleFilter === 'operator') roleMatch = r === 'Operator' || r === 'Technician';

      return nameMatch && plantMatch && roleMatch;
    });
  }, [staff, search, filterPlant, roleFilter, roles, onlineIds]);

  const plantsWithStaff = (plants ?? []).filter((p) => staff.some((s) => s.plant_assignments?.includes(p.id)));

  // Groups for grouped view
  const leadershipGroup = filteredStaff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r === 'Admin' || r === 'Manager';
  });
  const analystGroup = filteredStaff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r === 'Data Analyst';
  });
  const operatorGroup = filteredStaff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r !== 'Admin' && r !== 'Manager' && r !== 'Data Analyst';
  });

  return (
    <div className="space-y-3.5">
      {/* ── KPI Summary Strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl border border-border/70 bg-card flex items-center gap-3 shadow-2xs">
          <div className="h-9 w-9 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
            <Users className="h-4.5 w-4.5" />
          </div>
          <div>
            <p className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider">Total Staff</p>
            <p className="text-base font-bold text-foreground">{staff.length}</p>
          </div>
        </div>

        <div className="p-3 rounded-xl border border-border/70 bg-card flex items-center gap-3 shadow-2xs">
          <div className="h-9 w-9 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
            <div className="h-2.5 w-2.5 rounded-full bg-accent animate-pulse" />
          </div>
          <div>
            <p className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider">Live Online</p>
            <p className="text-base font-bold text-accent">{onlineCount} <span className="text-3xs text-muted-foreground font-normal">active</span></p>
          </div>
        </div>

        <div className="p-3 rounded-xl border border-border/70 bg-card flex items-center gap-3 shadow-2xs">
          <div className="h-9 w-9 rounded-lg bg-info-soft text-info flex items-center justify-center shrink-0">
            <Crown className="h-4.5 w-4.5" />
          </div>
          <div>
            <p className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider">Leadership</p>
            <p className="text-base font-bold text-foreground">{leadershipCount}</p>
          </div>
        </div>

        <div className="p-3 rounded-xl border border-border/70 bg-card flex items-center gap-3 shadow-2xs">
          <div className="h-9 w-9 rounded-lg bg-kpi-ro/15 text-kpi-ro flex items-center justify-center shrink-0">
            <BarChart2 className="h-4.5 w-4.5" />
          </div>
          <div>
            <p className="text-3xs font-semibold text-muted-foreground uppercase tracking-wider">Analysts & Ops</p>
            <p className="text-base font-bold text-foreground">{analystCount + operatorCount}</p>
          </div>
        </div>
      </div>

      {/* ── Search & Filter Controls ── */}
      <div className="p-3 rounded-xl border border-border/70 bg-card/80 backdrop-blur-sm space-y-2.5 shadow-2xs">
        <div className="flex flex-col md:flex-row items-center justify-between gap-2.5">
          {/* Search */}
          <div className="relative w-full md:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, username, plant…"
              className="pl-8 h-8 text-xs bg-background"
            />
          </div>

          {/* Plant selector + View mode toggle */}
          <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
            <select
              value={filterPlant}
              onChange={(e) => setFilterPlant(e.target.value)}
              className="h-8 text-xs border rounded-lg px-2.5 bg-background text-foreground shrink-0"
            >
              <option value="all">All Plant Locations</option>
              {plantsWithStaff.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            {/* View switcher */}
            <div className="flex items-center gap-0.5 bg-muted/60 p-0.5 rounded-lg border border-border/50">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={cn(
                  'h-7 px-2 text-xs font-semibold rounded-md flex items-center gap-1 transition-all',
                  viewMode === 'grid'
                    ? 'bg-card text-primary shadow-xs border border-border/80'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="Grid cards"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Cards</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={cn(
                  'h-7 px-2 text-xs font-semibold rounded-md flex items-center gap-1 transition-all',
                  viewMode === 'table'
                    ? 'bg-card text-primary shadow-xs border border-border/80'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="Table directory"
              >
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Table</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grouped')}
                className={cn(
                  'h-7 px-2 text-xs font-semibold rounded-md flex items-center gap-1 transition-all',
                  viewMode === 'grouped'
                    ? 'bg-card text-primary shadow-xs border border-border/80'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="Grouped by department"
              >
                <Layers className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Grouped</span>
              </button>
            </div>
          </div>
        </div>

        {/* Role Quick Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs pt-1 border-t border-border/40">
          {(
            [
              { id: 'all', label: `All Staff (${staff.length})` },
              { id: 'online', label: `🟢 Online (${onlineCount})` },
              { id: 'leadership', label: `👑 Leadership (${leadershipCount})` },
              { id: 'analyst', label: `📊 Analysts (${analystCount})` },
              { id: 'operator', label: `⚙️ Operators (${operatorCount})` },
            ] as const
          ).map((rf) => (
            <button
              key={rf.id}
              type="button"
              onClick={() => setRoleFilter(rf.id)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-2xs font-bold whitespace-nowrap transition-all border',
                roleFilter === rf.id
                  ? 'bg-primary text-primary-foreground border-primary shadow-2xs'
                  : 'bg-muted/40 text-muted-foreground border-border/60 hover:text-foreground hover:bg-muted',
              )}
            >
              {rf.label}
            </button>
          ))}
          <span className="ml-auto text-3xs text-muted-foreground shrink-0 pl-2">
            Showing {filteredStaff.length} of {staff.length}
          </span>
        </div>
      </div>

      {/* ── Content View Rendering ── */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredStaff.map((s) => (
            <StaffCard
              key={s.id}
              member={s}
              roles={roles as any[]}
              plants={plants as any[]}
              isSelf={s.id === (activeOperator?.id ?? user?.id)}
              onlineIds={onlineIds}
              onChat={() => setChatPeer(s)}
              onDetail={() => setDetailMember(s)}
            />
          ))}
          {filteredStaff.length === 0 && (
            <div className="col-span-full">
              <Card className="p-8 text-xs text-center text-muted-foreground border-dashed">
                No staff match your current search and role filters.
              </Card>
            </div>
          )}
        </div>
      )}

      {viewMode === 'table' && (
        <Card className="overflow-hidden border border-border/70 shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40 text-3xs uppercase tracking-wider text-muted-foreground font-bold">
                  <th className="py-2.5 px-3">Employee</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Assigned Plants</th>
                  <th className="py-2.5 px-3">Presence</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredStaff.map((s) => {
                  const presence = getPresence(s.updated_at, s.status, onlineIds.has(s.id));
                  const pc = presenceConfig[presence];
                  const memberRole = (roles as any[]).find((r) => r.user_id === s.id)?.role ?? 'Operator';
                  const rc = getRoleConfig(memberRole);
                  const isSelf = s.id === (activeOperator?.id ?? user?.id);
                  const assignedPlantNames = (s.plant_assignments ?? [])
                    .map((pid) => plants.find((p) => p.id === pid)?.name)
                    .filter(Boolean);

                  return (
                    <tr
                      key={s.id}
                      onClick={() => setDetailMember(s)}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center text-2xs font-bold text-white shrink-0', avatarColor(s.id))}>
                            {initials(s)}
                          </div>
                          <div>
                            <div className="font-bold text-foreground flex items-center gap-1.5">
                              <span>{fullName(s)}</span>
                              {isSelf && (
                                <span className="text-[10px] font-semibold px-1 rounded bg-primary-soft text-primary">you</span>
                              )}
                            </div>
                            {s.username && (
                              <div className="text-3xs text-muted-foreground font-mono">@{s.username}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-2 px-3">
                        <span className={cn('inline-flex items-center gap-1 text-3xs font-semibold px-2 py-0.5 rounded-md border', rc.bg, rc.color)}>
                          {rc.icon}
                          <span>{memberRole}</span>
                        </span>
                      </td>

                      <td className="py-2 px-3">
                        {assignedPlantNames.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {assignedPlantNames.map((name, i) => (
                              <span key={i} className="text-3xs px-1.5 py-0.2 rounded bg-muted font-medium text-foreground border border-border/60">
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-3xs text-muted-foreground/50 italic">All plants / Float</span>
                        )}
                      </td>

                      <td className="py-2 px-3">
                        <span className={cn('inline-flex items-center gap-1 text-3xs px-2 py-0.5 rounded-full border font-semibold', pc.badge)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', pc.dot)} />
                          {pc.label}
                        </span>
                      </td>

                      <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1">
                          {!isSelf && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary-soft"
                              onClick={() => setChatPeer(s)}
                              title="Direct Message"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-3xs font-medium rounded-lg"
                            onClick={() => setDetailMember(s)}
                          >
                            Profile
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {viewMode === 'grouped' && (
        <div className="space-y-4">
          {/* Leadership */}
          {leadershipGroup.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Crown className="h-4 w-4 text-danger" />
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Leadership & Administration ({leadershipGroup.length})
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {leadershipGroup.map((s) => (
                  <StaffCard
                    key={s.id}
                    member={s}
                    roles={roles as any[]}
                    plants={plants as any[]}
                    isSelf={s.id === (activeOperator?.id ?? user?.id)}
                    onlineIds={onlineIds}
                    onChat={() => setChatPeer(s)}
                    onDetail={() => setDetailMember(s)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Data Analysts */}
          {analystGroup.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <BarChart2 className="h-4 w-4 text-kpi-ro" />
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Data & Compliance Analytics ({analystGroup.length})
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {analystGroup.map((s) => (
                  <StaffCard
                    key={s.id}
                    member={s}
                    roles={roles as any[]}
                    plants={plants as any[]}
                    isSelf={s.id === (activeOperator?.id ?? user?.id)}
                    onlineIds={onlineIds}
                    onChat={() => setChatPeer(s)}
                    onDetail={() => setDetailMember(s)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Operators & Technicians */}
          {operatorGroup.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <UserCircle className="h-4 w-4 text-primary" />
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Plant Operations & Field Technical Team ({operatorGroup.length})
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {operatorGroup.map((s) => (
                  <StaffCard
                    key={s.id}
                    member={s}
                    roles={roles as any[]}
                    plants={plants as any[]}
                    isSelf={s.id === (activeOperator?.id ?? user?.id)}
                    onlineIds={onlineIds}
                    onChat={() => setChatPeer(s)}
                    onDetail={() => setDetailMember(s)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
    </div>
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

type KpiRange2 = 'today' | 7 | 14 | 30 | 90 | 365;
type KpiViewMode = 'team' | 'individual';

// ── Appraisal Rating System (for Annual & Quarterly Performance Reviews) ──
export type AppraisalTier = {
  tier: string;
  badge: string;
  dot: string;
  icon: string;
  minScore: number;
  description: string;
};

export const APPRAISAL_TIERS: AppraisalTier[] = [
  { tier: 'Outstanding', badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-500', icon: '🏆', minScore: 90, description: 'Exemplary operational logging compliance' },
  { tier: 'Exceeds Expectations', badge: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/40', dot: 'bg-teal-500', icon: '⭐', minScore: 80, description: 'Consistently surpasses standard logging targets' },
  { tier: 'Meets Target', badge: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40', dot: 'bg-sky-500', icon: '✓', minScore: 70, description: 'Meets operational logging expectations' },
  { tier: 'Needs Improvement', badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40', dot: 'bg-amber-500', icon: '⚠️', minScore: 50, description: 'Below standard compliance targets' },
  { tier: 'Unsatisfactory', badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40', dot: 'bg-rose-500', icon: '❌', minScore: 0, description: 'Critical gaps in operational logs' },
];

export function getAppraisalTier(scorePct: number): AppraisalTier {
  for (const t of APPRAISAL_TIERS) {
    if (scorePct >= t.minScore) return t;
  }
  return APPRAISAL_TIERS[APPRAISAL_TIERS.length - 1];
}

// Computes overall weighted KPI score across all active categories and days in range
export function computeEntityOverallScore(ts: EntityTypeScore, days: string[], todayStr: string): {
  scorePct: number;
  totalValid: number;
  totalComplete: number;
  tier: AppraisalTier;
} {
  let scoreSum = 0;
  let scoreCount = 0;
  let totalComplete = 0;

  for (const col of INPUT_COLS) {
    const dayMap = ts[col.key];
    if (!dayMap) continue;
    for (const day of days) {
      const s = dayMap[day];
      if (s === null || s === undefined) continue;
      scoreCount++;
      const val = typeof s === 'number' ? Math.min(1, Math.max(0, s)) : 0;
      scoreSum += val;
      if (val >= 1.0) totalComplete++;
    }
  }

  const scorePct = scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 100) : 0;
  return {
    scorePct,
    totalValid: scoreCount,
    totalComplete,
    tier: getAppraisalTier(scorePct),
  };
}

// Each input type column definition — same 7-category taxonomy as the
// app's kpi-* dashboard tokens (Wells/Locator/RO/Meter/Solar/Grid/Chem),
// so a reading type reads as the same color here as it does everywhere
// else in the app.
const INPUT_COLS = [
  { key: 'wells',         label: 'Wells',       full: 'Wells Reading',    color: 'hsl(var(--kpi-wells))' },
  { key: 'locator',       label: 'Locator',     full: 'Locator Reading',  color: 'hsl(var(--kpi-locator))' },
  { key: 'ro_train',      label: 'RO Train',    full: 'RO Train (hourly)',color: 'hsl(var(--kpi-ro))' },
  { key: 'product_meter', label: 'Prod. Meter', full: 'Product Meter',    color: 'hsl(var(--kpi-meter))' },
  { key: 'solar',         label: 'Solar',       full: 'Solar Reading',    color: 'hsl(var(--kpi-solar))' },
  { key: 'grid',          label: 'Grid',        full: 'Grid Reading',     color: 'hsl(var(--kpi-grid))' },
  { key: 'chemicals',     label: 'Chemicals',   full: 'Chemical Dosing',  color: 'hsl(var(--kpi-chem))' },
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
  complete: { color: 'hsl(var(--reading-status-complete))', label: 'Complete' },
  partial:  { color: 'hsl(var(--reading-status-partial))',  label: 'Partial'  },
  minimal:  { color: 'hsl(var(--reading-status-minimal))',  label: 'Minimal'  },
  missed:   { color: 'hsl(var(--reading-status-missed))',   label: 'Missed'   },
  pending:  { color: 'hsl(var(--reading-status-pending))',  label: 'Pending (today)' },
  na:       { color: 'hsl(var(--reading-status-na))',       label: 'N/A'      },
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
    return [fmtIsoDate(new Date())];
  }
  const count = typeof range === 'number' ? range : 30;
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(fmtIsoDate(d));
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
  // days[0] is a Manila calendar date (e.g. "2026-08-15"); Manila midnight of
  // that date is 16:00 UTC the *previous* UTC day (Asia/Manila = UTC+8), so
  // anchor the query with an explicit +08:00 offset rather than 'Z' — using
  // 'Z' here would silently drop the first 8 hours of that Manila day.
  const since = useMemo(() => days[0] + 'T00:00:00+08:00', [days]);
  // Every reading is now bucketed into an Asia/Manila calendar day (see
  // fmtIsoDate usage below and in EntityHistoryChart.tsx), so "today" and
  // the elapsed-hours proration here use Manila time too, to match those
  // buckets. These have to stay in sync with the bucketing logic below ��
  // not just here.
  // Cheap to compute, so no useMemo — they naturally refresh on every
  // render (including a manual "Refresh" click) without needing a
  // refreshKey-only dependency array.
  const todayStr = fmtIsoDate(new Date());
  const now = new Date();
  const nowManila = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  const elapsedFraction = Math.min(1, Math.max(0, (nowManila.getHours() + nowManila.getMinutes() / 60) / 24));

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
      const day = fmtIsoDate(r.reading_datetime); // Asia/Manila bucketing, matches generateDays2/todayStr above
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      (twellMap[tk] = twellMap[tk] ?? new Set()).add(r.well_id);
      if (!r.recorded_by) return;
      const k = `${r.recorded_by}:${r.plant_id}:${day}`;
      (wellMap[k] = wellMap[k] ?? new Set()).add(r.well_id);
    });

    locReadings.forEach((r) => {
      const day = fmtIsoDate(r.reading_datetime); // Asia/Manila bucketing, matches generateDays2/todayStr above
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      (tlocMap[tk] = tlocMap[tk] ?? new Set()).add(r.locator_id);
      if (!r.recorded_by) return;
      const k = `${r.recorded_by}:${r.plant_id}:${day}`;
      (locMap[k] = locMap[k] ?? new Set()).add(r.locator_id);
    });

    roReadings.forEach((r) => {
      const day = fmtIsoDate(r.reading_datetime); // Asia/Manila bucketing, matches generateDays2/todayStr above
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}:${r.train_id}`;
      troMap[tk] = (troMap[tk] ?? 0) + 1;
      if (!r.recorded_by) return;
      const k = `${r.recorded_by}:${r.plant_id}:${day}:${r.train_id}`;
      roMap[k] = (roMap[k] ?? 0) + 1;
    });

    meterReadings.forEach((r) => {
      const day = fmtIsoDate(r.reading_datetime); // Asia/Manila bucketing, matches generateDays2/todayStr above
      if (!daySet.has(day)) return;
      const tk = `${r.plant_id}:${day}`;
      (tmeterMap[tk] = tmeterMap[tk] ?? new Set()).add(r.meter_id);
      if (!r.recorded_by) return;
      const k = `${r.recorded_by}:${r.plant_id}:${day}`;
      (meterMap[k] = meterMap[k] ?? new Set()).add(r.meter_id);
    });

    powerReadings.forEach((r) => {
      const day = fmtIsoDate(r.reading_datetime); // Asia/Manila bucketing, matches generateDays2/todayStr above
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
    { label: '90D (Qtr)', value: 90 },
    { label: 'Annual (YTD)', value: 365 },
  ];

  // Appraisal CSV export generator for HR / Annual Review
  const exportAppraisalCsv = () => {
    const headers = [
      'Operator Name', 'Username', 'Plant',
      'Wells %', 'Locator %', 'RO Train %', 'Prod Meter %', 'Solar %', 'Grid %', 'Chemicals %',
      'Overall KPI Score %', 'Appraisal Rating Tier', 'Period Range',
    ];
    const rows: string[][] = [];

    plantsWithOps.forEach((plant) => {
      const plantOps = operators.filter((op) => op.plant_assignments?.includes(plant.id));
      plantOps.forEach((op) => {
        const matKey = `${op.id}:${plant.id}`;
        const ts = individual[matKey] ?? {};
        const overall = computeEntityOverallScore(ts, days, todayStr);

        const catScores = INPUT_COLS.map((col) => {
          const dayMap = ts[col.key] ?? {};
          const validDays = days.map((d) => dayMap[d]).filter((s): s is number => typeof s === 'number');
          if (!validDays.length) return 'N/A';
          const avg = Math.round((validDays.reduce((a, b) => a + b, 0) / validDays.length) * 100);
          return `${avg}%`;
        });

        rows.push([
          `"${fullName(op)}"`,
          `"${op.username ?? ''}"`,
          `"${plant.name}"`,
          ...catScores.map((s) => `"${s}"`),
          `"${overall.scorePct}%"`,
          `"${overall.tier.tier}"`,
          `"${range === 'today' ? 'Today' : `${range} Days`}"`,
        ]);
      });
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `operator_annual_appraisal_kpi_${range}_${todayStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Annual appraisal KPI report exported successfully.');
  };

  // Pre-calculate appraisal breakdown for summary
  const appraisalStats = useMemo(() => {
    let outstanding = 0, exceeds = 0, meets = 0, needsImp = 0, unsat = 0;
    const operatorScores: { op: StaffMember; plantName: string; scorePct: number; tier: AppraisalTier }[] = [];

    plantsWithOps.forEach((plant) => {
      const plantOps = operators.filter((op) => op.plant_assignments?.includes(plant.id));
      plantOps.forEach((op) => {
        const matKey = `${op.id}:${plant.id}`;
        const ts = individual[matKey] ?? {};
        const overall = computeEntityOverallScore(ts, days, todayStr);
        operatorScores.push({ op, plantName: plant.name, scorePct: overall.scorePct, tier: overall.tier });

        if (overall.scorePct >= 90) outstanding++;
        else if (overall.scorePct >= 80) exceeds++;
        else if (overall.scorePct >= 70) meets++;
        else if (overall.scorePct >= 50) needsImp++;
        else unsat++;
      });
    });

    const avgScore = operatorScores.length > 0
      ? Math.round(operatorScores.reduce((a, b) => a + b.scorePct, 0) / operatorScores.length)
      : 0;

    return { outstanding, exceeds, meets, needsImp, unsat, avgScore, totalEvaluated: operatorScores.length };
  }, [plantsWithOps, operators, individual, days, todayStr]);

  return (
    <div className="space-y-3.5">
      {/* ── Annual Appraisal Overview Strip ── */}
      <div className="p-3.5 rounded-xl border border-border/70 bg-card/80 backdrop-blur-sm space-y-2.5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
              <Award className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-foreground">Operational KPI & Appraisal Index</h3>
                <span className={cn('text-3xs font-bold px-2 py-0.5 rounded-full border', getAppraisalTier(appraisalStats.avgScore).badge)}>
                  {getAppraisalTier(appraisalStats.avgScore).icon} Fleet Avg: {appraisalStats.avgScore}%
                </span>
              </div>
              <p className="text-3xs text-muted-foreground">Comprehensive weighted logging compliance for operator evaluations</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2.5 text-2xs gap-1.5 font-semibold bg-background"
              onClick={exportAppraisalCsv}
              title="Download full operator appraisal matrix in CSV"
            >
              <FileDown className="h-3.5 w-3.5 text-primary" />
              <span>Export Appraisal CSV</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => setRefreshKey((k) => k + 1)}
              title="Refresh matrix"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Appraisal tier breakdown bar */}
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border/40 text-2xs">
          <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">Appraisal Tiers:</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-bold">
            🏆 Outstanding (≥90%): {appraisalStats.outstanding}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/30 font-bold">
            ⭐ Exceeds (80-89%): {appraisalStats.exceeds}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30 font-bold">
            ✓ Meets (70-79%): {appraisalStats.meets}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-bold">
            ⚠️ Needs Imp (&lt;70%): {appraisalStats.needsImp + appraisalStats.unsat}
          </span>
        </div>
      </div>

      {/* ── Controls (Period & View Mode) ── */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-2 rounded-xl bg-muted/40 border border-border/60">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Time range selector */}
          <div className="flex rounded-lg border bg-background overflow-hidden p-0.5 shadow-2xs">
            {RANGES.map(({ label, value }) => (
              <button
                key={String(value)}
                className={cn(
                  'px-2.5 py-1 text-2xs font-bold rounded-md transition-all',
                  range === value
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
                onClick={() => setRange(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Mode switch */}
          <div className="flex rounded-lg border bg-background overflow-hidden p-0.5 shadow-2xs">
            <button
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 text-2xs font-bold rounded-md transition-all',
                viewMode === 'team'
                  ? 'bg-kpi-ro text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
              onClick={() => setViewMode('team')}
            >
              <Building2 className="h-3 w-3" /> Team Coverage
            </button>
            <button
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 text-2xs font-bold rounded-md transition-all',
                viewMode === 'individual'
                  ? 'bg-kpi-ro text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
              onClick={() => setViewMode('individual')}
            >
              <User className="h-3 w-3" /> Individual Activity
            </button>
          </div>
        </div>

        <div className="text-2xs text-muted-foreground flex items-center gap-2">
          {viewMode === 'team' ? (
            <span><strong className="text-foreground">{plantsWithOps.length}</strong> plants</span>
          ) : (
            <span><strong className="text-foreground">{operators.length}</strong> evaluated operators</span>
          )}
          <span>·</span>
          <span className={cn('font-bold', summary.pct >= 80 ? 'text-accent' : summary.pct >= 50 ? 'text-warn' : 'text-danger')}>
            {summary.pct}% Overall Logging Rate
          </span>
        </div>
      </div>

      {/* Legend */}
      <KpiLegend2 />

      {/* Info banner */}
      <div className="flex items-start gap-2 bg-info-soft border border-info/40 rounded-xl px-3.5 py-2.5 text-xs text-info shadow-2xs">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span className="leading-relaxed">
          {viewMode === 'team' ? (
            <><strong>Team Coverage Lens:</strong> Verifies if each asset was logged by anyone on schedule (operator shift or automated feed). This evaluates overall plant compliance.</>
          ) : (
            <><strong>Individual Activity Lens (Annual Appraisal Metric):</strong> Evaluates individual operator diligence across all logging responsibilities. The <strong>Overall Appraisal KPI</strong> score provides a weighted percentage and rating tier (🏆 Outstanding to ❌ Unsatisfactory) for annual appraisals.</>
          )}
          {' '}Targets: Wells ≥1/well/day · Locators ≥1/day · RO Train {DEFAULT_RO_HOURLY_TARGET}/train/day · Prod. Meters ≥1/day · Power ≥1/day · Chemicals ≥1/day.
        </span>
      </div>

      {/* ── Matrix Table with Overall Score Column ── */}
      <Card className="overflow-hidden border border-border/70 shadow-2xs">
        <DataState
          loading={isLoading}
          error={kpiError}
          isEmpty={plantsWithOps.length === 0}
          emptyTitle="No operators assigned to any plant."
          onRetry={retryKpiQueries}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              {/* Column headers */}
              <thead>
                <tr className="border-b bg-muted/60">
                  <th className="text-left px-3 py-2.5 font-bold text-xs sticky left-0 bg-muted/60 z-10 min-w-[170px]">
                    {viewMode === 'team' ? 'Plant Facility' : 'Operator / Facility'}
                  </th>
                  {/* Overall KPI Column */}
                  <th className="py-2.5 px-3 font-bold text-center bg-muted/80 border-x border-border/60 min-w-[140px]">
                    <div className="flex flex-col items-center">
                      <span className="text-2xs font-extrabold uppercase tracking-wide text-foreground">Overall KPI Score</span>
                      <span className="text-[10px] text-muted-foreground font-normal">Appraisal Rating</span>
                    </div>
                  </th>
                  {INPUT_COLS.map((col) => (
                    <th key={col.key} className="py-2.5 px-1 font-semibold text-center">
                      <span
                        className="inline-block px-2 py-0.5 rounded text-white text-3xs font-bold whitespace-nowrap shadow-2xs"
                        style={{ background: col.color }}
                      >
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
                    const overall = computeEntityOverallScore(ts, days, todayStr);

                    return (
                      <tr key={`team:${plant.id}`} className="border-b hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 sticky left-0 z-10 bg-background"
                          style={{ borderLeft: `3px solid ${accent.line}` }}>
                          <div className="flex items-center gap-2">
                            <Building2 className={cn('h-3.5 w-3.5 shrink-0', accent.text)} />
                            <span className={cn('font-bold text-xs', accent.text)}>{plant.name}</span>
                          </div>
                        </td>

                        {/* Plant Overall Score */}
                        <td className="py-2 px-3 border-x border-border/60 bg-muted/10 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-extrabold text-xs text-foreground">{overall.scorePct}%</span>
                              <span className={cn('text-3xs px-1.5 py-0.2 rounded-full border font-bold', overall.tier.badge)}>
                                {overall.tier.icon} {overall.tier.tier}
                              </span>
                            </div>
                            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden border border-border/50">
                              <div
                                className={cn('h-full transition-all', overall.tier.dot)}
                                style={{ width: `${overall.scorePct}%` }}
                              />
                            </div>
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

                    // Compute plant aggregate score
                    const plantOpScores = plantOps.map((op) => {
                      const matKey = `${op.id}:${plant.id}`;
                      return computeEntityOverallScore(individual[matKey] ?? {}, days, todayStr).scorePct;
                    });
                    const plantAvgScore = plantOpScores.length > 0
                      ? Math.round(plantOpScores.reduce((a, b) => a + b, 0) / plantOpScores.length)
                      : 0;
                    const plantTier = getAppraisalTier(plantAvgScore);

                    // Plant header row
                    rows.push(
                      <tr
                        key={`ph:${plant.id}`}
                        className="border-b cursor-pointer select-none bg-muted/20 hover:bg-muted/40 transition-colors"
                        onClick={() => togglePlant(plant.id)}
                      >
                        <td
                          className="px-3 py-2.5 sticky left-0 z-10 bg-background"
                          style={{ borderLeft: `3px solid ${accent.line}` }}
                        >
                          <div className="flex items-center gap-2">
                            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform shrink-0', accent.text, isExpanded && 'rotate-90')} />
                            <Building2 className={cn('h-3.5 w-3.5 shrink-0', accent.text)} />
                            <span className={cn('font-bold text-xs', accent.text)}>{plant.name}</span>
                            <span className="text-3xs px-1.5 py-0.2 rounded-full bg-muted font-bold text-muted-foreground border border-border/60">
                              {plantOps.length} staff
                            </span>
                          </div>
                        </td>

                        {/* Plant aggregate KPI score */}
                        <td className="py-2 px-3 border-x border-border/60 bg-muted/30 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-extrabold text-xs text-foreground">{plantAvgScore}%</span>
                              <span className={cn('text-3xs px-1.5 py-0.2 rounded-full border font-bold', plantTier.badge)}>
                                {plantTier.icon} {plantTier.tier}
                              </span>
                            </div>
                            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden border border-border/50">
                              <div
                                className={cn('h-full transition-all', plantTier.dot)}
                                style={{ width: `${plantAvgScore}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Plant aggregate summary dots */}
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
                                <div
                                  className="h-2.5 w-2.5 rounded-sm shadow-2xs"
                                  style={{ background: scoreColor(avg), opacity: 0.9 }}
                                />
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );

                    // Operator rows (when expanded)
                    if (isExpanded) {
                      plantOps.forEach((op) => {
                        const matKey = `${op.id}:${plant.id}`;
                        const ts = individual[matKey] ?? {};
                        const opOverall = computeEntityOverallScore(ts, days, todayStr);

                        rows.push(
                          <tr key={`op:${matKey}`} className="border-b hover:bg-muted/30 transition-colors">
                            <td
                              className="px-3 py-2 sticky left-0 z-10 bg-background pl-8"
                              style={{ borderLeft: `3px solid ${accent.line}` }}
                            >
                              <div className="flex items-center gap-2">
                                <div className={cn('h-6 w-6 rounded-lg flex items-center justify-center text-3xs font-bold text-white shrink-0 shadow-2xs', avatarColor(op.id))}>
                                  {initials(op)}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-foreground truncate max-w-[120px] leading-tight">
                                    {fullName(op)}
                                  </div>
                                  {op.username && (
                                    <div className="text-3xs text-muted-foreground font-mono truncate">@{op.username}</div>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Operator Overall KPI score */}
                            <td className="py-1.5 px-3 border-x border-border/60 bg-muted/15 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-center gap-1">
                                  <span className="font-extrabold text-xs text-foreground">{opOverall.scorePct}%</span>
                                  <span className={cn('text-3xs px-1.5 py-0.2 rounded-md border font-semibold truncate max-w-[100px]', opOverall.tier.badge)}>
                                    {opOverall.tier.icon} {opOverall.tier.tier}
                                  </span>
                                </div>
                                <div className="w-24 h-1.5 rounded-full bg-muted/80 overflow-hidden border border-border/40">
                                  <div
                                    className={cn('h-full transition-all', opOverall.tier.dot)}
                                    style={{ width: `${opOverall.scorePct}%` }}
                                  />
                                </div>
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
          </div>
        </DataState>
      </Card>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          { label: viewMode === 'team' ? 'Coverage Rate' : 'Overall Logging Rate', value: `${summary.pct}%`, color: summary.pct >= 80 ? 'text-accent' : summary.pct >= 50 ? 'text-warn' : 'text-danger' },
          { label: viewMode === 'team' ? 'Asset-Days Logged' : 'Cells Completed', value: `${summary.complete}/${summary.total}`, color: 'text-info' },
          { label: viewMode === 'team' ? 'Assets Missed' : 'Cells Missed', value: `${summary.missed}`, color: summary.missed === 0 ? 'text-accent' : 'text-danger' },
          { label: 'Pending Today', value: `${summary.pending}`, color: summary.pending === 0 ? 'text-muted-foreground' : 'text-info' },
        ].map((s) => (
          <div key={s.label} className="flex flex-col items-center bg-card rounded-xl border border-border/70 py-3 px-2 text-center gap-0.5 shadow-2xs">
            <span className={cn('text-xl font-bold leading-none', s.color)}>{s.value}</span>
            <span className="text-3xs uppercase font-bold text-muted-foreground tracking-wider">{s.label}</span>
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

const ALL_MANUAL_CHAPTERS = BOOK_PARTS.flatMap((p) => p.chapters);

function AppManual() {
  const [bookOpen, setBookOpen] = useState(false);
  const [initialChapterId, setInitialChapterId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');

  const openAt = (chapterId?: string) => {
    setInitialChapterId(chapterId);
    setBookOpen(true);
  };

  const q = query.trim().toLowerCase();
  const suggestions = q
    ? ALL_MANUAL_CHAPTERS.filter(
        (c) => c.title.toLowerCase().includes(q) || c.dek.toLowerCase().includes(q),
      ).slice(0, 6)
    : [];

  return (
    <div className="rounded-lg border overflow-hidden bg-gradient-to-br from-primary/5 via-background to-background">
      <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="shrink-0 w-14 h-14 rounded-lg bg-primary/10 flex items-center justify-center">
          <BookOpen className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-book-heading text-2xl font-semibold text-foreground leading-tight">
            Operations Manual
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {ALL_MANUAL_CHAPTERS.length} chapters, from your first sign-in to running the Admin Console —
            open it as a book, or search for a topic below.
          </p>
        </div>
        <button
          onClick={() => openAt(undefined)}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <BookOpen className="h-3.5 w-3.5" /> Open Manual
        </button>
      </div>

      <div className="border-t bg-muted/20 px-5 py-4 sm:px-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-foreground">Shift handover quick start</div>
            <div className="text-2xs text-muted-foreground">A practical path for the next reading round.</div>
          </div>
          <button onClick={() => openAt('operations')} className="shrink-0 text-2xs font-medium text-primary hover:underline">Open daily entry</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['Confirm context', 'Check the plant and asset tab before entering a value.', 'dashboard'],
            ['Log the shift', 'Save Wells & Locators, then complete RO and dosing records.', 'operations'],
            ['Close the loop', 'Review flags and send corrections through the review workflow.', 'data-corrections'],
          ].map(([label, detail, chapter]) => (
            <button key={label} onClick={() => openAt(chapter)} className="flex items-start gap-2 rounded-md border bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span><span className="block text-xs font-medium text-foreground">{label}</span><span className="mt-0.5 block text-2xs leading-relaxed text-muted-foreground">{detail}</span></span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 sm:px-6 pb-5 sm:pb-6">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a topic — e.g. “compliance thresholds” or “delete a user”…"
            className="pl-8 h-9 text-xs bg-background"
          />
        </div>
        {suggestions.length > 0 && (
          <div className="mt-2 border rounded-md overflow-hidden bg-background">
            {suggestions.map((c) => (
              <button
                key={c.id}
                onClick={() => openAt(c.id)}
                className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-muted/50 transition-colors border-b last:border-b-0"
              >
                <span className="font-sans tabular-nums text-muted-foreground w-4 text-right shrink-0">{c.number}</span>
                <span className="text-foreground font-medium">{c.title}</span>
                <span className="text-muted-foreground truncate">— {c.dek}</span>
              </button>
            ))}
          </div>
        )}
        {q && suggestions.length === 0 && (
          <p className="text-2xs text-muted-foreground mt-2 px-1">No chapters match &ldquo;{query}&rdquo;.</p>
        )}
      </div>

      <BookReader open={bookOpen} onOpenChange={setBookOpen} initialChapterId={initialChapterId} />
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

  // Compute quick stats for the executive header strip
  const onlineCount = staff.filter((s) => {
    const p = getPresence(s.updated_at, s.status, false);
    return p === 'active' || p === 'idle';
  }).length;
  const activeCount = staff.filter((s) => s.status === 'Active').length;
  const leadershipCount = staff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r === 'Admin' || r === 'Manager';
  }).length;
  const operatorCount = staff.filter((s) => {
    const r = (roles as any[]).find((x) => x.user_id === s.id)?.role;
    return r === 'Operator' || r === 'Technician';
  }).length;

  return (
    <div className="space-y-3 animate-fade-in">
      {/* ── People & Staff Management Strip ── */}
      <div className="rounded-lg border border-border bg-card text-foreground p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Title */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-foreground">
                People &amp; Staff Management
              </h1>
              <span className="px-2 py-0.5 rounded-full text-2xs font-medium bg-primary-soft text-primary border border-primary/30">
                Staff Registry
              </span>
            </div>
            <p className="text-xs text-slate-300 flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>Staff Directory · KPI Heatmap · Org Chart · Operations Manual</span>
            </p>
          </div>

          {/* Quick KPI tiles */}
          <div className="grid grid-cols-4 gap-2 shrink-0">
            {[
              { label: 'Total Staff',  value: staff.length,     sub: `${activeCount} active`,  color: 'text-white' },
              { label: 'Online Now',   value: onlineCount,      sub: 'active / idle',            color: 'text-emerald-300' },
              { label: 'Leadership',   value: leadershipCount,  sub: 'admin + mgr',              color: 'text-sky-300' },
              { label: 'Operators',    value: operatorCount,    sub: 'field + tech',             color: 'text-indigo-300' },
            ].map((stat) => (
              <div key={stat.label} className="bg-white/[0.08] rounded-xl px-3 py-2 border border-white/10 text-center min-w-[64px]">
                <div className={`text-lg font-bold tabular-nums font-numeral leading-none ${stat.color}`}>{stat.value}</div>
                <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{stat.label}</div>
                <div className="text-[9px] text-slate-500 mt-0.5">{stat.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="w-full sm:w-auto grid grid-cols-3 sm:inline-flex gap-0.5 p-1 rounded-xl">
          <TabsTrigger value="staff" className="flex items-center gap-1.5 rounded-lg data-[state=active]:shadow-sm">
            <Users className="h-3.5 w-3.5" />
            <span>Staff</span>
            {staff.length > 0 && (
              <span className="ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                {staff.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="kpi" className="flex items-center gap-1.5 rounded-lg data-[state=active]:shadow-sm">
            <BarChart2 className="h-3.5 w-3.5" />
            <span>KPI</span>
          </TabsTrigger>
          <TabsTrigger value="info" className="flex items-center gap-1.5 rounded-lg data-[state=active]:shadow-sm">
            <Info className="h-3.5 w-3.5" />
            <span>Info</span>
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
