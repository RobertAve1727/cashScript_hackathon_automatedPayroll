/**
 * Saving the demo chain to localStorage, and reading it back intact.
 *
 * ══ WHY THIS NEEDS A CODEC AT ALL ═══════════════════════════════════════
 *
 * Two of the value types in this state cannot survive `JSON.stringify`:
 *
 *   bigint      throws outright — "Do not know how to serialize a BigInt".
 *               Every peso figure in this project is a bigint on purpose:
 *               centavos in integer arithmetic, never a float, because the
 *               covenant computes in integers and a rounded double would
 *               disagree with it by a centavo and make a transaction
 *               unspendable.
 *
 *   Uint8Array  does not throw, which is worse. It serialises to
 *               `{"0":156,"1":29,…}` and comes back as a plain object, so
 *               the 40-byte commitment would silently stop being bytes and
 *               every decode downstream would fail on something unrelated.
 *
 * So values of those two types are tagged on the way out and rebuilt on the
 * way in. Everything else passes through untouched.
 *
 * ══ THE VERSION FIELD ═══════════════════════════════════════════════════
 *
 * Stored state outlives the code that wrote it. A payload from an older
 * build, hydrated into a newer one, fails somewhere far from the cause —
 * usually mid-render, in front of an audience. `SCHEMA_VERSION` is bumped
 * whenever the shape changes; anything that does not match is discarded and
 * the demo reseeds from fixtures. Losing demo data is cheap. A white screen
 * is not.
 */

const SCHEMA_VERSION = 1

interface Envelope {
  readonly version: number
  readonly state: unknown
}

type Tagged = { readonly __t: 'bigint' | 'bytes'; readonly v: string }

function isTagged(value: unknown): value is Tagged {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__t' in value &&
    ((value as Tagged).__t === 'bigint' || (value as Tagged).__t === 'bytes')
  )
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

/**
 * Tag the two types JSON cannot carry.
 *
 * The replacer sees `this[key]` before serialisation, so a Uint8Array still
 * arrives as a Uint8Array here — checked before the generic object case, or
 * it would be flattened into the numeric-keyed form described above.
 */
function replacer(this: unknown, _key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return { __t: 'bigint', v: value.toString() }
  if (value instanceof Uint8Array) return { __t: 'bytes', v: toHex(value) }
  return value
}

function reviver(_key: string, value: unknown): unknown {
  if (!isTagged(value)) return value
  return value.__t === 'bigint' ? BigInt(value.v) : fromHex(value.v)
}

/**
 * Uint8Array reaches the replacer already converted when it is nested inside
 * another object being stringified, because JSON.stringify walks own
 * enumerable properties first. Serialising through this helper rather than
 * calling JSON.stringify directly keeps the tagging in one place.
 */
export function save(key: string, state: unknown): void {
  try {
    const envelope: Envelope = { version: SCHEMA_VERSION, state }
    window.localStorage.setItem(key, JSON.stringify(envelope, replacer))
  } catch {
    // Private browsing, storage disabled, or the quota is full. The demo
    // still works for this session; it just will not survive a reload.
  }
}

/** Returns null when there is nothing usable stored — caller seeds fixtures. */
export function load<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null

    const envelope = JSON.parse(raw, reviver) as Envelope
    if (envelope?.version !== SCHEMA_VERSION) {
      window.localStorage.removeItem(key)
      return null
    }

    return envelope.state as T
  } catch {
    // Corrupt or hand-edited. Same answer as absent.
    window.localStorage.removeItem(key)
    return null
  }
}

export function clear(keys: readonly string[]): void {
  try {
    for (const key of keys) window.localStorage.removeItem(key)
  } catch {
    /* nothing to do */
  }
}

export const STORAGE_KEYS = {
  chain: 'esahod.chain.v1',
  attendance: 'esahod.attendance.v1',
} as const
