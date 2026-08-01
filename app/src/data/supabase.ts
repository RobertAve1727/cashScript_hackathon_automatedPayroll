import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The Supabase client, and the rule about what it is allowed to hold.
 *
 * ══ WHAT LIVES HERE, AND WHAT LIVES ON CHAIN ════════════════════════════
 *
 * The database holds what the 40-byte commitment has no room for: names,
 * emails, departments, hire dates, attendance punches, overtime requests and
 * who approved them. Those are HRIS records. They belong in a database and
 * always did.
 *
 * It does NOT hold the truth about money. Salaries, period counters and
 * balances are in the NFT commitment and the treasury UTXO, and the chipnet
 * adapter reads them from there. The `employees` table mirrors some of those
 * columns so a roster can be rendered without a chain round-trip per row —
 * but where the two disagree, the chain is right and the row is stale.
 *
 * That distinction is the whole architecture. A payroll you can edit in a
 * database is the thing this project exists to replace, so the moment a
 * salary figure is trusted from here rather than from the commitment, the
 * guarantee is gone.
 *
 * ══ OPT-IN, LIKE THE CHAIN ADAPTER ══════════════════════════════════════
 *
 * With no `VITE_SUPABASE_*` variables the app runs entirely on its in-memory
 * demo data, exactly as before. A fresh clone needs no backend, and a demo
 * does not fail because a network is unreachable.
 *
 * ══ THE KEY ═════════════════════════════════════════════════════════════
 *
 * Only the anon/publishable key ever appears here. It is designed to ship in
 * a browser: it grants nothing on its own, because every table has row-level
 * security and the policies key off the signed-in user. The service_role key
 * bypasses RLS entirely and must never reach a bundle — anything needing it
 * belongs in `scripts/`.
 */

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let client: SupabaseClient | null = null

if (url && anonKey) {
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The app owns its own routing; a magic-link fragment left in the URL
      // would be parsed on every page load.
      detectSessionInUrl: false,
    },
  })
}

/** True when a backend is configured. Callers must branch on this. */
export function hasSupabase(): boolean {
  return client !== null
}

/**
 * The client, or null when unconfigured.
 *
 * Deliberately nullable rather than throwing: every caller has a working
 * offline path already, and a throw here would turn a missing env var into a
 * blank screen.
 */
export function supabase(): SupabaseClient | null {
  return client
}

/** Rows the app reads. Hand-written to match the deployed schema. */
export interface EmployeeRow {
  id: string
  employee_no: string
  first_name: string
  middle_name: string | null
  last_name: string
  department: string | null
  payee_pkh: string
  monthly_basic: number
  monthly_allowance: number
  tax_per_period: number
  next_period: number
  end_period: number | null
  status: 'active' | 'inactive'
}

export interface AttendanceRow {
  id: string
  employee_id: string
  work_date: string
  time_in: string | null
  time_out: string | null
  anchor_tx_id: string | null
}

export type OvertimeStatusRow = 'pending' | 'approved' | 'rejected'

export interface OvertimeRow {
  id: string
  employee_id: string
  work_date: string
  minutes: number
  reason: string
  status: OvertimeStatusRow
  filed_at: string
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
}

export interface ProfileRow {
  id: string
  role: 'hr' | 'payroll_officer' | 'employee'
  employee_id: string | null
  first_name: string | null
  middle_name: string | null
  last_name: string | null
}
