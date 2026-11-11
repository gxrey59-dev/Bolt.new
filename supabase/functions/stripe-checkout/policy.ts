/** Redirect destinations are deployment configuration, never trusted request headers. */
export function validateCheckoutRedirect(value: unknown, allowedUrls: string): string {
  if (typeof value !== 'string') throw new Error('A return URL is required.');
  const target = new URL(value);
  if (target.username || target.password || !['https:', 'http:'].includes(target.protocol)) {
    throw new Error('Invalid return URL.');
  }
  const allowed = allowedUrls.split(',').map(v => v.trim()).filter(Boolean);
  const matches = allowed.some(value => {
    const base = new URL(value);
    const path = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
    return target.origin === base.origin &&
      (target.pathname === base.pathname || target.pathname.startsWith(path));
  });
  if (!matches) throw new Error('Return URL is not an approved app destination.');
  return target.toString();
}

export function isPaidCheckout(eventType: string, session: { mode?: string | null; payment_status?: string }) {
  return ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(eventType)
    && session.mode === 'payment' && session.payment_status === 'paid';
}

export function objectId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id;
  return null;
}

export function integrationIdentifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `financial-weapon-${Array.from(bytes, byte => String.fromCharCode(97 + byte % 26)).join('')}`;
}
