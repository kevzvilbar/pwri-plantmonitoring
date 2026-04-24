import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bot, Send, Plus, Trash2, Loader2, Sparkles, Activity, Droplet,
  AlertTriangle, Calendar, RefreshCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePlants } from '@/hooks/usePlants';
import { useAppStore } from '@/store/appStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { DataState } from '@/components/DataState';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Msg = { role: 'user' | 'assistant'; content: string; created_at?: string };
type SessionPreview = { session_id: string; updated_at: string; preview: string };

type Anomaly = {
  well: string;
  date: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | string;
  value: number | null;
  baseline: number | null;
  message: string;
  suggested_action: string;
};

const BASE = (import.meta.env.REACT_APP_BACKEND_URL as string) || '';

async function api<T>(path: string, init?: RequestInit & { userId?: string }): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (init?.userId) headers['x-user-id'] = init.userId;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const t = await res.text();
    let msg = `HTTP ${res.status}`;
    try { msg = JSON.parse(t).detail || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

const SUGGESTIONS = [
  'List the top 3 abnormal consumption days this month across all plants.',
  'Show wells that have been flagged defective more than 3 times.',
  'What is the average daily volume for each plant in the last 7 days?',
  'Summarize downtime for RO trains over the past 14 days.',
];

// ---------------------------------------------------------------------------

export default function AIAssistant() {
  const { user } = useAuth();
  const { data: plants } = usePlants();
  const { selectedPlantId } = useAppStore();

  const [tab, setTab] = useState<'chat' | 'anomalies'>('chat');

  // --- Chat state ---------------------------------------------------------
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const { data: sessions, refetch: refetchSessions } = useQuery<SessionPreview[]>({
    queryKey: ['ai-sessions', user?.id],
    queryFn: () => api<SessionPreview[]>('/api/ai/sessions', { userId: user?.id }),
    staleTime: 10_000,
  });

  const loadSession = useCallback(async (sid: string) => {
    setSessionId(sid);
    try {
      const res = await api<{ session_id: string; messages: Msg[] }>(`/api/ai/sessions/${sid}`);
      setMessages(res.messages ?? []);
    } catch (e: any) {
      toast.error(`Failed to load session: ${e.message}`);
    }
  }, []);

  const newChat = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setInput('');
  }, []);

  const sendMessage = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: msg }]);
    setSending(true);
    try {
      const res = await api<{ session_id: string; reply: string; created_at: string }>(
        '/api/ai/chat', {
          method: 'POST',
          body: JSON.stringify({ message: msg, session_id: sessionId }),
          userId: user?.id,
        },
      );
      setSessionId(res.session_id);
      setMessages((m) => [...m, { role: 'assistant', content: res.reply, created_at: res.created_at }]);
      refetchSessions();
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ ${e.message}` }]);
      toast.error(`AI error: ${e.message}`);
    } finally {
      setSending(false);
    }
  }, [input, sessionId, user?.id, refetchSessions]);

  const deleteSession = useCallback(async (sid: string) => {
    try {
      await api(`/api/ai/sessions/${sid}`, { method: 'DELETE' });
      if (sid === sessionId) newChat();
      refetchSessions();
      toast.success('Conversation deleted');
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [sessionId, newChat, refetchSessions]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  // --- Anomaly scan state --------------------------------------------------
  const [scanPlant, setScanPlant] = useState<string>(selectedPlantId ?? '');
  const [scanWellId, setScanWellId] = useState<string>('all');
  const [scanDays, setScanDays] = useState<number>(30);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ anomalies: Anomaly[]; summary: string } | null>(null);

  useEffect(() => { if (selectedPlantId) setScanPlant(selectedPlantId); }, [selectedPlantId]);

  const { data: scanWells } = useQuery({
    queryKey: ['ai-wells', scanPlant],
    queryFn: async () => {
      if (!scanPlant) return [];
      const { data, error } = await supabase
        .from('wells').select('id,name').eq('plant_id', scanPlant).order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!scanPlant,
  });

  const runAnomalyScan = useCallback(async () => {
    if (!scanPlant) { toast.error('Pick a plant'); return; }
    setScanning(true);
    setScanResult(null);
    try {
      const since = new Date();
      since.setDate(since.getDate() - scanDays);

      let q = supabase.from('well_readings')
        .select('well_id,reading_datetime,previous_reading,current_reading,daily_volume,off_location_flag,wells(name)')
        .eq('plant_id', scanPlant)
        .gte('reading_datetime', since.toISOString())
        .order('reading_datetime', { ascending: true })
        .limit(1500);
      if (scanWellId !== 'all') q = q.eq('well_id', scanWellId);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.info('No readings in this window');
        setScanResult({ anomalies: [], summary: 'No readings to analyze in the selected window.' });
        return;
      }
      // Reshape for AI
      const readings = data.map((r: any) => ({
        well: r.wells?.name ?? r.well_id,
        date: (r.reading_datetime ?? '').slice(0, 10),
        initial: r.previous_reading,
        final: r.current_reading,
        volume: r.daily_volume,
        flags: r.off_location_flag ? ['off_location'] : [],
      }));
      const res = await api<{ anomalies: Anomaly[]; summary: string }>(
        '/api/ai/anomalies', { method: 'POST', body: JSON.stringify({ readings }) },
      );
      setScanResult(res);
      toast.success(`Found ${res.anomalies.length} anomaly(ies)`);
    } catch (e: any) {
      toast.error(`Scan failed: ${e.message}`);
    } finally {
      setScanning(false);
    }
  }, [scanPlant, scanWellId, scanDays]);

  const sortedAnomalies = useMemo(() => {
    const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (scanResult?.anomalies ?? []).slice().sort(
      (a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9),
    );
  }, [scanResult]);

  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-md bg-gradient-to-br from-sky-500 to-violet-600 text-white flex items-center justify-center">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AI Assistant</h1>
          <p className="text-xs text-muted-foreground">
            Ask questions about your data, or run anomaly scans on any plant.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'chat' | 'anomalies')}>
        <TabsList>
          <TabsTrigger value="chat"><Bot className="h-3.5 w-3.5 mr-1" />Chat</TabsTrigger>
          <TabsTrigger value="anomalies"><AlertTriangle className="h-3.5 w-3.5 mr-1" />Anomaly scan</TabsTrigger>
        </TabsList>

        {/* ---------------- CHAT TAB ---------------- */}
        <TabsContent value="chat" className="mt-3">
          <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
            {/* Sidebar - sessions */}
            <Card className="p-2 h-[calc(100vh-260px)] min-h-[400px] flex flex-col">
              <Button size="sm" onClick={newChat} className="w-full mb-2">
                <Plus className="h-3.5 w-3.5 mr-1" /> New chat
              </Button>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-1 mb-1">
                Recent
              </div>
              <div className="flex-1 overflow-auto -mx-1 space-y-1">
                <DataState isEmpty={!sessions || sessions.length === 0}
                  emptyTitle="No conversations yet"
                  emptyDescription="Start asking questions below."
                >
                  {(sessions ?? []).map((s) => (
                    <button
                      key={s.session_id}
                      onClick={() => loadSession(s.session_id)}
                      className={cn(
                        'w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-muted group flex items-start gap-1',
                        sessionId === s.session_id && 'bg-muted',
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="line-clamp-2">{s.preview || '(no messages)'}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {s.updated_at ? formatDistanceToNow(new Date(s.updated_at), { addSuffix: true }) : ''}
                        </div>
                      </div>
                      <Trash2
                        className="h-3 w-3 opacity-0 group-hover:opacity-70 hover:opacity-100 shrink-0 mt-0.5"
                        onClick={(e) => { e.stopPropagation(); deleteSession(s.session_id); }}
                      />
                    </button>
                  ))}
                </DataState>
              </div>
            </Card>

            {/* Main - chat thread */}
            <Card className="p-0 h-[calc(100vh-260px)] min-h-[400px] flex flex-col">
              <div className="flex-1 overflow-auto p-4 space-y-3">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6">
                    <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-2">
                      <Bot className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <h3 className="text-sm font-medium">How can I help?</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Ask about anomalies, downtime, NRW, chemicals or wells.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 justify-center max-w-lg">
                      {SUGGESTIONS.map((s) => (
                        <Button key={s} size="sm" variant="outline"
                                className="text-[11px] h-auto py-1.5 whitespace-normal text-left"
                                onClick={() => sendMessage(s)}>
                          {s}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <div key={i} className={cn('flex gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                      {m.role === 'assistant' && (
                        <div className="h-7 w-7 rounded-md bg-gradient-to-br from-sky-500 to-violet-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                          <Sparkles className="h-3.5 w-3.5" />
                        </div>
                      )}
                      <div className={cn(
                        'rounded-lg px-3 py-2 max-w-[80%] text-sm whitespace-pre-wrap break-words',
                        m.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted',
                      )}>
                        {m.content}
                      </div>
                    </div>
                  ))
                )}
                {sending && (
                  <div className="flex gap-2">
                    <div className="h-7 w-7 rounded-md bg-gradient-to-br from-sky-500 to-violet-600 text-white flex items-center justify-center shrink-0">
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <div className="rounded-lg px-3 py-2 bg-muted text-sm flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="border-t p-2 flex gap-2">
                <Input
                  value={input}
                  placeholder="Ask anything about your operations…"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                  }}
                  disabled={sending}
                  className="flex-1"
                />
                <Button onClick={() => sendMessage()} disabled={sending || !input.trim()}>
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ---------------- ANOMALIES TAB ---------------- */}
        <TabsContent value="anomalies" className="mt-3">
          <Card className="p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_180px_140px] items-end">
              <div>
                <Label className="text-xs">Plant</Label>
                <Select value={scanPlant} onValueChange={setScanPlant}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Pick plant…" /></SelectTrigger>
                  <SelectContent>
                    {(plants ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Well</Label>
                <Select value={scanWellId} onValueChange={setScanWellId} disabled={!scanPlant}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="All wells" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All wells</SelectItem>
                    {(scanWells ?? []).map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Window (days)</Label>
                <Select value={String(scanDays)} onValueChange={(v) => setScanDays(Number(v))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[7, 14, 30, 60, 90].map((d) => (
                      <SelectItem key={d} value={String(d)}>{d} days</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={scanning || !scanPlant} onClick={runAnomalyScan}>
                {scanning ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Scanning…</>
                          : <><Activity className="h-3.5 w-3.5 mr-1" /> Run scan</>}
              </Button>
            </div>

            {scanResult && (
              <div className="mt-4 space-y-2">
                <div className="rounded-md bg-muted/50 border p-2 text-xs flex items-start gap-2">
                  <Sparkles className="h-3.5 w-3.5 mt-0.5 text-sky-600 shrink-0" />
                  <span>{scanResult.summary}</span>
                </div>
                {scanResult.anomalies.length === 0 ? (
                  <DataState isEmpty emptyTitle="No anomalies detected" emptyDescription="All clear in this window." />
                ) : (
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr className="text-left text-[11px] text-muted-foreground">
                          <th className="px-2 py-1.5">Sev</th>
                          <th className="px-2 py-1.5">Well</th>
                          <th className="px-2 py-1.5">Date</th>
                          <th className="px-2 py-1.5">Type</th>
                          <th className="px-2 py-1.5 text-right">Value</th>
                          <th className="px-2 py-1.5 text-right">Baseline</th>
                          <th className="px-2 py-1.5">Message</th>
                          <th className="px-2 py-1.5">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAnomalies.map((a, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-2 py-1">
                              <SeverityBadge sev={a.severity} />
                            </td>
                            <td className="px-2 py-1"><span className="inline-flex items-center gap-1"><Droplet className="h-3 w-3 text-muted-foreground" />{a.well}</span></td>
                            <td className="px-2 py-1 font-mono-num"><span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3 text-muted-foreground" />{a.date}</span></td>
                            <td className="px-2 py-1">{a.type}</td>
                            <td className="px-2 py-1 text-right font-mono-num">{a.value ?? '—'}</td>
                            <td className="px-2 py-1 text-right font-mono-num">{a.baseline ?? '—'}</td>
                            <td className="px-2 py-1">{a.message}</td>
                            <td className="px-2 py-1 text-muted-foreground">{a.suggested_action}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SeverityBadge({ sev }: { sev: string }) {
  const map: Record<string, string> = {
    high:   'bg-rose-100 text-rose-700 border-rose-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low:    'bg-sky-100 text-sky-700 border-sky-200',
  };
  const tone = map[sev] ?? 'bg-muted text-muted-foreground border-transparent';
  return (
    <Badge variant="outline" className={cn('font-normal capitalize', tone)}>{sev}</Badge>
  );
}
