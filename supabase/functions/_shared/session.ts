// Session subject for Edge Functions deployed with platform JWT verification on.
// The runtime rejects an unsigned or expired token before our handler runs, so the
// payload read here is already trusted. auth.getUser() answers with neither user
// nor error on some deployments, and the verified subject covers that case.

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sessionUserId(token: string): string {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || !parts[1]) return '';
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { sub?: unknown; role?: unknown };
    if (claims.role !== 'authenticated') return '';
    return typeof claims.sub === 'string' && uuidPattern.test(claims.sub) ? claims.sub : '';
  } catch {
    return '';
  }
}
