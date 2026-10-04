# Security rollout checklist

Companion to `SECURITY.md`. Code for items marked **(in repo)** ships with the repo;
everything else is a one-time manual step in a dashboard. Nothing here contains secrets.

## 0. Do first (manual, today)
- [ ] **Rotate the admin password** that was committed in `memory/PRD.md` and two archived
      migrations. It is in public git history and must be treated as compromised.
      Supabase > Authentication > Users > the admin user > reset password (generated, from a
      password manager). Also check any other account that used the same pattern.
- [ ] **Revoke sessions** for that user (Supabase > Authentication > Users > Sign out user), or
      run `DELETE FROM auth.sessions WHERE user_id = '<admin uuid>';` in the SQL editor.
- [ ] **Review sign-in history** for that account since the first leaked commit
      (Supabase > Logs > Auth, and the `login_attempts` table). Look for IPs or times you do not recognize.
- [ ] **Decide repo visibility.** The repo contains breach-response and retention runbooks,
      compliance plans, RLS and migration history. Settings > General > Change visibility > Private,
      unless it must be public.
- [ ] *(Optional)* **Purge the password from history.** Rotation is what protects you; this is cleanup.
      ```bash
      git clone --mirror <repo-url> pwri.git && cd pwri.git
      printf '%s\n' '<OLD_PASSWORD>==>REMOVED' > replacements.txt   # never commit this file
      git filter-repo --replace-text replacements.txt
      git push --force --mirror
      ```
      Everyone must re-clone afterwards; forks and cached views on GitHub may keep the old commits.
      If you do this, delete the SHAs from `.gitleaks.toml` > `[allowlist].commits`.

## 1. GitHub settings (manual)
- [ ] Settings > Code security: enable **Secret scanning**, **Push protection**, **Dependabot alerts**
      and **Dependabot security updates**. (Dependabot *version* updates ship in `.github/dependabot.yml`.)
- [ ] Settings > Branches: protect `main`, require PR review and **Require review from Code Owners**
      (makes `.github/CODEOWNERS` effective).
- [ ] The `Secret scan` workflow **(in repo)** fails builds on new secrets or plaintext passwords.

## 2. Supabase settings (manual)
- [ ] Authentication > Multi-factor: make sure **TOTP** is enabled.
- [ ] Authentication > Providers/Policies: enable **leaked password protection** and set a minimum
      password length of 12 or more.
- [ ] Authentication > Sign In / Providers: confirm public sign-ups are intended (new accounts are
      held until an Admin approves them).
- [ ] If your plan allows: Authentication > Sessions, set a session time-box and inactivity timeout.

## 3. Admin MFA rollout (code in repo)
Shipped by this patch: the sign-in gate (`AdminMfaGate`), the Admin-page idle lock (`AdminIdleLock`),
migration `20261004000003_admin_mfa_enforcement.sql`, and the aal2 check in `admin-update-user-email`.
The database side is **dormant until you flip the switch**, so nobody is locked out on deploy.

1. Apply the migration and deploy the app and the edge function:
   `supabase db push && supabase functions deploy admin-update-user-email`.
2. Every Admin signs in; the gate offers TOTP enrollment (they may skip until enforcement is on).
3. Run `supabase/runbooks/admin-authz-verify.sql`; **section 6 must show `totp_enrolled = true` for every Admin.**
4. Enforce:
   ```sql
   UPDATE public.security_settings SET value = true WHERE key = 'require_admin_mfa';
   ```
   From now on an Admin session without aal2 cannot INSERT/UPDATE/DELETE anything, cannot call the admin
   RPCs, and cannot use `admin-update-user-email`. Updates and deletes by an aal1 admin are silently filtered
   to **zero rows** by RLS (no error), which is why the UI gate must come first.
5. Rollback: the same statement with `false`.
6. Lost authenticator? Delete the factor in Supabase > Authentication > Users, then the Admin re-enrolls.
   Keep at least two Admins enrolled.

Adding a table later? Put `SELECT public.apply_admin_mfa_guards();` at the end of that migration.

## 4. Known limits
- Security headers in `frontend/vercel.json` only protect the Vercel deployment. **GitHub Pages cannot send
  response headers**, so that copy cannot send `frame-ancestors` / HSTS (the meta-tag CSP, including the
  hashed `script-src`, still applies there). Retire the Pages deploy if clickjacking protection matters.
- The idle lock re-prompts for a TOTP code and never signs out, so the offline queue is not discarded. It
  protects an unattended screen; it does not shorten the server-side session.
