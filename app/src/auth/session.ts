import { useEffect, useState } from 'react'
import { findUser, USERS, type Role, type User } from './users'
import { hasSupabase, supabase, type ProfileRow } from '../data/supabase'

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

/**
 * Sign in against Supabase when a backend is configured, and against the
 * bundled fixture table when it is not.
 *
 * The difference is real. Through Supabase the password is verified by the
 * server, the session is a signed JWT, and every subsequent query is filtered
 * by row-level security keyed to that user — an employee's `select * from
 * employees` returns exactly their own row, because the policy says so rather
 * than because the UI asked nicely. Offline, none of that is true and the
 * sign-in screen says so.
 *
 * The role comes from `profiles.role`, which the caller cannot change: an
 * earlier version of this schema let a signed-in employee update their own
 * profile row and make themselves HR, and a trigger now refuses that.
 *
 * Falls back rather than failing. A demo should not go dark because a network
 * is unreachable, and the offline path is the one this app shipped with.
 */
export async function signInAsync(
  email: string,
  password: string,
): Promise<{ user: User | null; backend: 'supabase' | 'offline'; error?: string }> {
  const client = supabase()

  if (!client) {
    return { user: signInWithCredentials(email, password), backend: 'offline' }
  }

  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error || !data.user) {
      return {
        user: null,
        backend: 'supabase',
        ...(error?.message === undefined ? {} : { error: error.message }),
      }
    }

    const { data: profile } = await client
      .from('profiles')
      .select('id, role, employee_id, first_name, middle_name, last_name')
      .eq('id', data.user.id)
      .maybeSingle<ProfileRow>()

    // Map the server's answer onto the fixture the UI already knows, so the
    // screens keep their employee numbers and blurbs. The ROLE is the
    // server's, never the fixture's.
    const fixture = USERS.find((entry) => entry.email.toLowerCase() === email.trim().toLowerCase())
    // The server's stored name parts win when present; the fixture fills the
    // rest so the screens keep their employee numbers and blurbs.
    const merged: User = {
      id: fixture?.id ?? data.user.id,
      firstName: profile?.first_name ?? fixture?.firstName ?? (data.user.email ?? 'User').split('@')[0]!,
      lastName: profile?.last_name ?? fixture?.lastName ?? '',
      ...(profile?.middle_name ?? fixture?.middleName
        ? { middleName: (profile?.middle_name ?? fixture?.middleName)! }
        : {}),
      role: mapRole(profile?.role) ?? fixture?.role ?? 'employee',
      title: fixture?.title ?? '',
      email: data.user.email ?? email,
      password: '',
      blurb: fixture?.blurb ?? '',
      ...(fixture?.employeeNo === undefined ? {} : { employeeNo: fixture.employeeNo }),
    }

    current = merged
    try {
      window.localStorage.setItem(STORAGE_KEY, merged.id)
    } catch {
      /* not fatal */
    }
    emit()

    return { user: merged, backend: 'supabase' }
  } catch (thrown) {
    return {
      user: null,
      backend: 'supabase',
      error: thrown instanceof Error ? thrown.message : String(thrown),
    }
  }
}

function mapRole(role: ProfileRow['role'] | undefined): Role | undefined {
  if (role === 'hr') return 'hr'
  if (role === 'payroll_officer') return 'treasurer'
  if (role === 'employee') return 'employee'
  return undefined
}

/** Which backend authenticated this session, for the UI to state plainly. */
export function authBackend(): 'supabase' | 'offline' {
  return hasSupabase() ? 'supabase' : 'offline'
}

export function signOut(): void {
  // Ends the server session too, not just the local one — otherwise the JWT
  // stays valid and a later tab picks the session straight back up.
  void supabase()?.auth.signOut()

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
