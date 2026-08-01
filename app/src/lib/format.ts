/**
 * The single peso formatter. Centavos in, PHP display out — everywhere the UI
 * shows money it goes through here, so an amount can never be rendered with a
 * float in the loop.
 */
export function formatPeso(centavos: bigint): string {
  const negative = centavos < 0n;
  const abs = negative ? -centavos : centavos;
  const pesos = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = (abs % 100n).toString().padStart(2, '0');

  return `${negative ? '−' : ''}₱${pesos}.${cents}`;
}

/** ePHP token units are centavos by construction (1 unit = 1 centavo). */
export function formatEphp(units: bigint): string {
  return `${units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ePHP`;
}

/**
 * Parse a peso amount typed by a human ("35,000", "35000.5", "35000.50") into
 * bigint centavos. Returns null when the text is not a peso amount.
 */
export function parsePesoInput(text: string): bigint | null {
  const cleaned = text.replace(/[,\s₱]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;

  const [wholeRaw, fractionRaw] = cleaned.split('.');
  const whole = wholeRaw === undefined || wholeRaw === '' ? '0' : wholeRaw;
  const fraction = (fractionRaw ?? '').padEnd(2, '0');

  return BigInt(whole) * 100n + BigInt(fraction === '' ? '0' : fraction);
}

/** Lowercase hex for an arbitrary byte string. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Shorten a long hex string / txid for display: first 10 … last 6. */
export function truncateHex(hex: string, head = 10, tail = 6): string {
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** Format a unix-ms timestamp as a short PH-style date-time. */
export function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
