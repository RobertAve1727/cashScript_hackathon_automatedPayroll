/**
 * The mock directory — one account per role, for a demo with no backend.
 *
 * These are fixtures, not a security boundary. There is no password check, no
 * token, and no server: signing in picks which role's screens to show, and the
 * choice lives in localStorage. Anyone can open the console and change it.
 *
 * That is the honest position for a hackathon demo, and it is worth being
 * precise about why it costs nothing here: eSahod's actual guarantees are not
 * enforced by this login. The covenant does not care who is signed in —
 * `paySalary` takes no signature at all, so a forged session cannot redirect a
 * centavo, and `amend()` needs HR's KEY rather than HR's account. What this
 * screen decides is which pages a user sees, not what the chain will accept.
 */

export type Role = 'employee' | 'hr' | 'treasurer';

/**
 * The shared demo password.
 *
 * One value across every account, and printed on the sign-in screen. A demo
 * where each account has its own secret is a demo where somebody mistypes it
 * on stage — the credential check is real, keeping it secret is not the point.
 */
export const DEMO_PASSWORD = 'esahod2026';

export interface User {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly title: string;
  readonly email: string;
  readonly password: string;
  /** Set for employees — links the account to its employment NFT. */
  readonly employeeNo?: number;
  /** Shown on the sign-in screen so a judge can pick a role without guessing. */
  readonly blurb: string;
}

export const USERS: readonly User[] = [
  {
    id: 'maria',
    email: 'maria.santos@esahod.ph',
    password: DEMO_PASSWORD,
    name: 'Maria Santos',
    role: 'employee',
    title: 'Systems Analyst',
    employeeNo: 1001,
    blurb: 'Clock in, watch the punch land on chain, read the payslip it produces.',
  },
  {
    id: 'jun',
    email: 'jun.delacruz@esahod.ph',
    password: DEMO_PASSWORD,
    name: 'Jun Dela Cruz',
    role: 'employee',
    title: 'Warehouse Associate',
    employeeNo: 1002,
    blurb: 'A minimum-wage earner — zero withholding tax, so the BIR output disappears.',
  },
  {
    id: 'rosa',
    email: 'rosa.villanueva@esahod.ph',
    password: DEMO_PASSWORD,
    name: 'Rosa Villanueva',
    role: 'hr',
    title: 'HR Officer',
    blurb: 'Issue and amend employment records, review attendance, choose the pay cadence.',
  },
  {
    id: 'ben',
    email: 'ben.aquino@esahod.ph',
    password: DEMO_PASSWORD,
    name: 'Ben Aquino',
    role: 'treasurer',
    title: 'Payroll Officer',
    blurb: 'Fund the treasury and run payroll — a role with no power to redirect a peso.',
  },
];

export function findUser(id: string): User | undefined {
  return USERS.find((user) => user.id === id);
}

export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  employee: 'Employee',
  hr: 'Human Resources',
  treasurer: 'Payroll Officer',
};
