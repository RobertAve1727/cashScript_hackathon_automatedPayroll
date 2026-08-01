import { useEffect, useState } from 'react'

/**
 * Proof view — one switch that reveals the protocol underneath the payroll.
 *
 * Two audiences use these screens and they want opposite things. A payroll
 * officer, an HR officer and an employee want a payroll system: names, pesos,
 * dates, statuses. Someone evaluating whether this is genuinely on chain wants
 * the 40-byte commitment, the OP_RETURN payload and the anchor transactions.
 *
 * Showing both at once serves neither. An 80-character hex string under every
 * employee is duplication — every field in it is already printed in words on
 * the same row — and at 200 employees it buries the data someone came to read.
 * Hiding it entirely would throw away the evidence that the claims are real.
 *
 * So it is a mode, defaulting to OFF: the app is a payroll system until
 * somebody asks it to prove itself.
 *
 * Deliberately NOT gated by this switch: anything a user acts on. The output
 * diagram stays, because who was paid what is payroll, not protocol. Payslip
 * figures, statutory bases and the reconciliation stay, because they are the
 * product. Only the bytes are optional.
 *
 * A module-level store with a subscriber set, mirroring `auth/session.ts`:
 * the header, the pages and the shared components all read it, and threading
 * a provider through the design system's chrome would mean editing components
 * that are otherwise carried over untouched.
 */

const STORAGE_KEY = 'esahod.proofView'

let enabled = read()
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    // Private browsing, or storage disabled. The mode still toggles for the
    // session; it just will not survive a reload.
    return false
  }
}

export function isProofView(): boolean {
  return enabled
}

export function setProofView(next: boolean): void {
  if (enabled === next) return

  enabled = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
  } catch {
    /* not fatal — see read() */
  }
  for (const listener of listeners) listener()
}

export function toggleProofView(): void {
  setProofView(!enabled)
}

/** Subscribe a component to the mode. */
export function useProofView(): boolean {
  const [value, setValue] = useState(enabled)

  useEffect(() => {
    const listener = (): void => setValue(enabled)
    listeners.add(listener)
    // The store may have changed between render and effect.
    listener()

    return () => {
      listeners.delete(listener)
    }
  }, [])

  return value
}
