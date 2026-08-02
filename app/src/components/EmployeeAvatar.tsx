/**
 * An employee's face in a list.
 *
 * Photographs are HRIS profile data, not chain data. The 40-byte commitment
 * has no room for one and never will, so this deliberately does NOT come
 * through `ChainGateway` — putting a portrait URL on a read model whose whole
 * point is "this is what the NFT says" would blur the line the rest of the app
 * works to keep sharp.
 *
 * Instead the photo is derived from the employee number: stable across
 * reloads, no state to keep in sync, and an employee issued during the demo
 * simply falls back to their initials rather than borrowing a stranger's face.
 * The fallback is the common case in a real deployment, where most people have
 * not uploaded anything.
 */

/** The avatar set carried over from the design system. */
const PHOTO_COUNT = 8

/** Fixtures with a photograph. Anyone else gets initials. */
const PHOTOGRAPHED = new Set([1001, 1002])

const TONES = ['primary', 'success', 'info', 'warning', 'danger', 'purple'] as const

export type AvatarSize = 'sm' | 'md' | 'lg'

export function EmployeeAvatar(props: {
  name: string
  employeeNo: number
  size?: AvatarSize
  /** Adds the design system's online dot, for someone currently clocked in. */
  online?: boolean
}) {
  const size = props.size ?? 'md'
  const classes = `avatar avatar-${size} rounded-circle flex-shrink-0${props.online ? ' online' : ''}`

  if (PHOTOGRAPHED.has(props.employeeNo)) {
    // 1-based, and stable: the same employee always gets the same portrait.
    const index = ((props.employeeNo - 1) % PHOTO_COUNT) + 1
    const file = `user-${String(index).padStart(2, '0')}.jpg`

    return (
      <span className={classes}>
        <img alt={props.name} className="img-fluid rounded-circle" src={`/build/img/users/${file}`} />
      </span>
    )
  }

  const tone = TONES[props.employeeNo % TONES.length]

  return (
    <span
      className={`${classes} bg-${tone}-transparent d-flex align-items-center justify-content-center`}
      aria-label={props.name}
    >
      <span className="fw-medium">{initials(props.name)}</span>
    </span>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'

  return parts
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
}
