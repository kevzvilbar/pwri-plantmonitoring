/**
 * supabaseErrors.ts
 *
 * Maps raw Postgres/PostgREST error messages to friendly, user-facing strings.
 * Import `friendlyError` anywhere you currently do `toast.error(error.message)`.
 *
 * Usage:
 *   import { friendlyError } from '@/lib/supabaseErrors';
 *   toast.error(friendlyError(error));
 */

interface SupabaseError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

type AnyError = SupabaseError | Error | unknown;

/** Constraint name → human-readable explanation */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  uix_well_one_per_user_per_hour:
    'A reading for this well was already saved in the last hour. ' +
    'Open the existing reading to update the pressure field instead.',
  uix_locator_one_per_user_per_hour:
    'A reading for this locator was already saved in the last hour.',
  reading_gap_reasons_entity_type_entity_id_gap_date_key:
    'A gap reason for this entity and date already exists. Edit the existing entry.',
};

/** PostgREST schema-cache messages → hints */
const SCHEMA_CACHE_PATTERN = /could not find the table ['"]public\.(\w+)['"]/i;

/** Postgres duplicate-key pattern */
const DUPLICATE_KEY_PATTERN =
  /duplicate key value violates unique constraint "(\w+)"/i;

/** Postgres FK violation */
const FK_PATTERN = /violates foreign key constraint/i;

/** Postgres not-null violation */
const NOT_NULL_PATTERN = /null value in column "(\w+)" .* violates not-null/i;

/** Column-does-not-exist pattern (schema drift) */
const MISSING_COLUMN_PATTERN = /column "(\w+)" of relation "\w+" does not exist/i;

/**
 * Returns a friendly, safe-to-display string for any Supabase/Postgres error.
 * Falls back to the raw message if no specific match is found.
 */
export function friendlyError(err: AnyError, fallback = 'An unexpected error occurred.'): string {
  const msg =
    err instanceof Error
      ? err.message
      : (err as SupabaseError)?.message ?? String(err ?? '');

  if (!msg) return fallback;

  // 1. Known constraint violations
  const dupMatch = msg.match(DUPLICATE_KEY_PATTERN);
  if (dupMatch) {
    const constraintName = dupMatch[1];
    if (CONSTRAINT_MESSAGES[constraintName]) {
      return CONSTRAINT_MESSAGES[constraintName];
    }
    // Generic duplicate
    return 'This entry already exists. Please check for duplicates before saving.';
  }

  // 2. Schema cache miss (table not found)
  const schemaMatch = msg.match(SCHEMA_CACHE_PATTERN);
  if (schemaMatch) {
    const table = schemaMatch[1];
    return (
      `The "${table}" feature requires a database update. ` +
      'Please ask your administrator to run the latest migrations (supabase db push).'
    );
  }

  // 3. FK violation
  if (FK_PATTERN.test(msg)) {
    return 'This record is still in use by other data and cannot be deleted.';
  }

  // 4. Not-null violation
  const nullMatch = msg.match(NOT_NULL_PATTERN);
  if (nullMatch) {
    const col = nullMatch[1].replace(/_/g, ' ');
    return `A required field is missing: "${col}". Please fill it in and try again.`;
  }

  // 5. Missing column (schema drift — backend migration not yet applied)
  const colMatch = msg.match(MISSING_COLUMN_PATTERN);
  if (colMatch) {
    return (
      `A database field ("${colMatch[1]}") is missing. ` +
      'The latest migration may not have been applied yet.'
    );
  }

  // 6. Auth errors
  if (msg.toLowerCase().includes('invalid login credentials')) {
    return 'Incorrect email or password.';
  }
  if (msg.toLowerCase().includes('already registered')) {
    return 'That email address is already in use.';
  }

  // 7. Generic network / JWT
  if (msg.toLowerCase().includes('jwt')) {
    return 'Your session has expired. Please sign in again.';
  }
  if (msg.toLowerCase().includes('networkerror') || msg.toLowerCase().includes('failed to fetch')) {
    return 'Network error — please check your connection and try again.';
  }

  // 8. Fallback to raw message (acceptable for most app-level errors)
  return msg;
}
