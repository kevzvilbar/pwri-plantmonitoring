export interface PendingNotice {
  email: string;
  count: number;
}

export function EmailConfirmationNotice({
  notice,
  onClearNotice,
}: {
  notice: PendingNotice;
  onClearNotice?: () => void;
}) {
  return (
    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-800 dark:text-emerald-200 flex items-start justify-between gap-2 animate-fade-in">
      <div className="space-y-1">
        <p className="font-semibold text-emerald-900 dark:text-emerald-100 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
          Registration Submitted (Pending Approval)
        </p>
        <p className="text-muted-foreground leading-relaxed">
          {notice.count > 1
            ? `${notice.count} operator accounts have been submitted for ${notice.email}.`
            : `Your account registration for ${notice.email} has been submitted.`}{' '}
          An administrator will review and activate your account under Admin Console → Employees before you can sign in.
        </p>
      </div>
      {onClearNotice && (
        <button
          type="button"
          onClick={onClearNotice}
          className="text-muted-foreground hover:text-foreground p-1 text-sm font-bold"
          aria-label="Dismiss notice"
        >
          ×
        </button>
      )}
    </div>
  );
}
