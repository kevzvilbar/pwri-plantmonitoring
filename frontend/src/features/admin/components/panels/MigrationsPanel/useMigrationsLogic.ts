import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { friendlyError } from '@/lib/supabaseErrors';
import { toast } from '@/components/ui/sonner';
import { useAuth } from '@/hooks/useAuth';
import {
  listMigrationStatus, markMigrationApplied, unmarkMigrationApplied, importApplyHistory,
  type MigrationsResponse, type MigrationFile, type MigrationApplyHistory,
} from '@/lib/migrationsStatus';

const MIGRATIONS_SHA_KEY = 'pwri:migration-shas-v1';

export function useMigrationsLogic() {
  const { user, profile, isAdmin } = useAuth();
  const actorLabel = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.username || null;

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [showApplied, setShowApplied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [unmarkTarget, setUnmarkTarget] = useState<string | null>(null);
  const [seenShas, setSeenShas] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(MIGRATIONS_SHA_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch (readErr) {
      console.warn('[Admin] failed to read seen migration SHAs:', readErr);
      return {};
    }
  });

  const persistShas = (next: Record<string, string>) => {
    setSeenShas(next);
    try {
      localStorage.setItem(MIGRATIONS_SHA_KEY, JSON.stringify(next));
    } catch (writeErr) {
      console.warn('[Admin] failed to persist seen migration SHAs:', writeErr);
    }
  };

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-migrations-status'],
    queryFn: (): Promise<MigrationsResponse> => listMigrationStatus(),
  });

  const copySql = async (filename: string, sql: string) => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(filename);
      toast.success(`Copied ${filename} — paste into Supabase SQL editor.`);
      setTimeout(() => setCopied((c) => (c === filename ? null : c)), 2500);
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  const pendingFiles = useMemo(() => {
    return (data?.files ?? []).filter(
      (f) => f.probed_status === 'pending' || f.probed_status === 'partial',
    );
  }, [data]);

  const currentShas = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of data?.files ?? []) {
      if (f.sha256) out[f.filename] = f.sha256;
    }
    return out;
  }, [data]);

  useEffect(() => {
    if (!data) return;
    if (Object.keys(seenShas).length === 0 && Object.keys(currentShas).length > 0) {
      persistShas(currentShas);
    }
  }, [data]);

  const driftCount = useMemo(() => {
    let n = 0;
    for (const [name, sha] of Object.entries(currentShas)) {
      if (seenShas[name] && seenShas[name] !== sha) n += 1;
    }
    return n;
  }, [currentShas, seenShas]);

  const handleRecheck = async () => {
    const result = await refetch();
    const fresh: Record<string, string> = {};
    for (const f of result.data?.files ?? []) {
      if (f.sha256) fresh[f.filename] = f.sha256;
    }
    if (Object.keys(fresh).length > 0) persistShas(fresh);

    const purged = result.data?.purged_overrides ?? [];
    if (purged.length > 0) {
      const list = purged.length <= 3
        ? purged.join(', ')
        : `${purged.slice(0, 3).join(', ')} +${purged.length - 3} more`;
      toast.success(
        `Cleaned up ${purged.length} stale override${purged.length === 1 ? '' : 's'} ` +
        `(probe now confirms applied): ${list}`,
      );
    }
  };

  const supabaseSqlEditorUrl = useMemo<string | null>(() => {
    const explicit = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
    let ref = explicit?.trim() || '';
    if (!ref) {
      const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
      const m = url.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
      if (m) ref = m[1];
    }
    if (!ref) return null;
    return `https://supabase.com/dashboard/project/${ref}/sql/new`;
  }, []);

  const openInSupabase = async (filename: string, sql: string) => {
    if (!supabaseSqlEditorUrl) return;
    try {
      await navigator.clipboard.writeText(sql);
      toast.success(`Copied ${filename} — paste into the Supabase SQL editor that just opened`);
    } catch {
      toast.info(`Opening Supabase SQL editor — copy ${filename}'s SQL manually from the panel`);
    }
    window.open(supabaseSqlEditorUrl, '_blank', 'noopener,noreferrer');
  };

  const buildPendingBundle = (): { text: string; sizeKb: string } | null => {
    if (pendingFiles.length === 0) return null;
    const stamp = new Date().toISOString();
    const header = [
      '-- ============================================================',
      `-- PWRI Monitoring · pending Supabase migrations bundle`,
      `-- Generated: ${stamp}`,
      `-- Files: ${pendingFiles.length}`,
      '-- Paste into Supabase Dashboard → SQL editor → Run.',
      '-- All bundled files use `if not exists` / `drop … if exists` guards,',
      '-- so re-running an already-applied file is safe.',
      '-- ============================================================',
      '',
    ].join('\n');
    const body = pendingFiles
      .map((f) => {
        const banner =
          `-- ===== ${f.filename} (${f.probed_status}) ` +
          '='.repeat(Math.max(0, 60 - f.filename.length - f.probed_status.length));
        const trailer = `-- ===== end ${f.filename} ` + '='.repeat(40);
        return `${banner}\n${f.sql.trimEnd()}\n${trailer}\n`;
      })
      .join('\n');
    const text = `${header}${body}`;
    return { text, sizeKb: (text.length / 1024).toFixed(1) };
  };

  const copyAllPending = async () => {
    const bundle = buildPendingBundle();
    if (!bundle) {
      toast.info('Nothing to copy — no pending or partial migrations.');
      return;
    }
    try {
      await navigator.clipboard.writeText(bundle.text);
      toast.success(
        `Copied ${pendingFiles.length} pending migration${
          pendingFiles.length === 1 ? '' : 's'
        } (${bundle.sizeKb} KB).`,
      );
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  const downloadHistory = () => {
    const entries: Record<string, MigrationApplyHistory> = {};
    for (const f of data?.files ?? []) {
      if (f.apply_history?.applied_at) {
        entries[f.filename] = f.apply_history;
      }
    }
    const count = Object.keys(entries).length;
    if (count === 0) {
      toast.info('No apply-history entries to export yet.');
      return;
    }
    const payload = {
      exported_at: new Date().toISOString(),
      migrations_dir: data?.migrations_dir ?? null,
      history: entries,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
    const filename = `pwri-migration-apply-history-${stamp}.json`;
    try {
      const text = JSON.stringify(payload, null, 2);
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(
        `Exported ${count} apply-history entr${count === 1 ? 'y' : 'ies'} → ${filename}`,
      );
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  const hasAnyHistory = useMemo(
    () => (data?.files ?? []).some((f) => !!f.apply_history?.applied_at),
    [data],
  );

  const [importing, setImporting] = useState(false);

  const handleImportHistoryFile = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        toast.error('Selected file is not valid JSON.');
        return;
      }
      const historyObj = parsed?.history ?? parsed;
      if (!historyObj || typeof historyObj !== 'object' || Array.isArray(historyObj)) {
        toast.error('Imported file must contain a "history" object keyed by filename.');
        return;
      }

      const out = await importApplyHistory({ history: historyObj }, 'fill_gaps', actorLabel, user?.id ?? null);
      const added = out.added.length;
      const skipExist = out.skipped_existing.length;
      const skipUnk = out.skipped_unknown.length;
      const skipBad = out.skipped_invalid.length;
      const parts = [
        `${added} added`,
        skipExist > 0 ? `${skipExist} skipped (already recorded)` : null,
        skipUnk > 0 ? `${skipUnk} skipped (unknown filename)` : null,
        skipBad > 0 ? `${skipBad} skipped (invalid)` : null,
      ].filter(Boolean).join(' · ');
      if (added > 0) toast.success(`Imported apply-history: ${parts}`);
      else toast.info(`Nothing new imported: ${parts || 'all entries were already present'}`);
      await refetch();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setImporting(false);
    }
  };

  const downloadAllPending = () => {
    const bundle = buildPendingBundle();
    if (!bundle) {
      toast.info('Nothing to download — no pending or partial migrations.');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
    const filename = `pwri-pending-migrations-${stamp}.sql`;
    try {
      const blob = new Blob([bundle.text], { type: 'application/sql;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(
        `Downloaded ${filename} (${pendingFiles.length} file${
          pendingFiles.length === 1 ? '' : 's'
        }, ${bundle.sizeKb} KB).`,
      );
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  const markApplied = async (filename: string) => {
    const note = window.prompt(
      `Mark "${filename}" as applied?\n\nUse this for migrations the schema probe can't verify (RPCs, one-shot UPDATEs, pure DML).\n\nOptional note (e.g. "ran in Supabase SQL editor on 2026-04-25"):`,
      '',
    );
    if (note === null) return;
    try {
      setBusy(filename);
      await markMigrationApplied(filename, note || null, user?.id ?? null, actorLabel);
      toast.success(`Marked ${filename} as applied.`);
      await refetch();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const unmarkApplied = async (filename: string) => {
    try {
      setBusy(filename);
      await unmarkMigrationApplied(filename);
      toast.success(`Cleared mark for ${filename}.`);
      await refetch();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const [nameFilter, setNameFilter] = useState('');

  const visibleFiles = useMemo(() => {
    if (!data?.files) return [];
    let rows = showApplied ? data.files : data.files.filter((f) => f.status !== 'applied');
    const q = nameFilter.trim().toLowerCase();
    if (q) rows = rows.filter((f) => f.filename.toLowerCase().includes(q));
    return rows;
  }, [data, showApplied, nameFilter]);

  const visibleBeforeFilter = useMemo(() => {
    if (!data?.files) return 0;
    return showApplied
      ? data.files.length
      : data.files.filter((f) => f.status !== 'applied').length;
  }, [data, showApplied]);

  return {
    isAdmin, isLoading, error, refetch, isFetching, data,
    actorLabel, expanded, setExpanded, copied, setCopied,
    showApplied, setShowApplied, busy, setBusy, unmarkTarget, setUnmarkTarget,
    seenShas, nameFilter, setNameFilter, importing,
    pendingFiles, driftCount, supabaseSqlEditorUrl, hasAnyHistory,
    visibleFiles, visibleBeforeFilter,
    handleRecheck, copySql, openInSupabase, copyAllPending,
    downloadHistory, downloadAllPending, markApplied, unmarkApplied,
    handleImportHistoryFile, buildPendingBundle,
  };
}
