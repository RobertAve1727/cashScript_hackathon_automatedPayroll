import { useEffect, useState } from 'react'
import { findUser, USERS, type Role, type User } from './users'

/**
 * Who is signed in, persisted across a reload.
 *
 * A module-level store with a subscriber set rather than React context: the
 * sidebar, the header and every page read the session, and threading a
 * provider through the design system's chrome would mean editing components
 * that are otherwise carried over untouched.
 */

const STORAGE_KEY = 'esahod.session.userId'

let current: User | null = readStoredUser()
const listeners = new Set<() => void>()

function readStoredUser(): User | null {
  try {
    const id = window.localStorage.getItem(STORAGE_KEY)
    return id === null ? null : (findUser(id) ?? null)
  } catch {
    // Private browsing, or storage disabled. Signing in still works for the
    // session; it just will not survive a reload.
    return null
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

export function signIn(userId: string): User | null {
  const user = findUser(userId)
  if (!user) return null

  current = user
  try {
    window.localStorage.setItem(STORAGE_KEY, user.id)
  } catch {
    /* not fatal — see readStoredUser */
  }
  emit()

  return user
}

/**
 * Sign in with an email and password.
 *
 * The check is real — a wrong password does not get in — but it is a check
 * against a table in the bundle, which anyone can read. It decides which
 * role's pages to render and nothing else. eSahod's actual guarantees do not
 * rest on it: `paySalary` takes no signature at all, so a forged session
 * cannot redirect a centavo, and amending a record needs HR's KEY rather than
 * HR's account.
 *
 * The email match is case-insensitive and trimmed, because people type their
 * address the way their keyboard capitalises it. The password is compared
 * exactly, as a password should be.
 */
export function signInWithCredentials(email: string, password: string): User | null {
  const candidate = email.trim().toLowerCase()
  const user = USERS.find((entry) => entry.email.toLowerCase() === candidate)

  if (!user || user.password !== password) return null

  return signIn(user.id)
}

export function signOut(): void {
  current = null
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* not fatal */
  }
  emit()
}

export function currentUser(): User | null {
  return current
}

/** Subscribe a component to the signed-in user. */
export function useSession(): User | null {
  const [user, setUser] = useState<User | null>(current)

  useEffect(() => {
    const listener = (): void => setUser(current)
    listeners.add(listener)
    // The store may have changed between render and effect.
    listener()

    return () => {
      listeners.delete(listener)
    }
  }, [])

  return user
}

/** True when `user` may open a page restricted to `roles`. */
export function canAccess(user: User | null, roles: readonly Role[]): boolean {
  return user !== null && roles.includes(user.role)
}
