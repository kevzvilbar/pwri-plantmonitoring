/**
 * Safe Navigation & URL Sanitizer
 * Protects against Open Redirect vulnerabilities (CWE-601 / CVE-2025-68470).
 */

export function sanitizeInternalPath(path: string | null | undefined, fallback = '/'): string {
  if (!path || typeof path !== 'string') return fallback;

  const trimmed = path.trim();

  // Block protocol-relative URLs (e.g., "//attacker.com" or "\\attacker.com")
  if (/^[/\\]{2,}/.test(trimmed)) {
    return fallback;
  }

  // Block javascript: or data: URIs
  if (/^(javascript|data|vbscript):/i.test(trimmed)) {
    return fallback;
  }

  // Block full absolute URLs (e.g. "https://attacker.com")
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return fallback;
  }

  // Ensure it begins with a single forward slash
  if (!trimmed.startsWith('/')) {
    return `/${trimmed}`;
  }

  return trimmed;
}

