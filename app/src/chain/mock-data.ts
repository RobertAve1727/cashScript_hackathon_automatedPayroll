/**
 * Fabricated chain identities for the mock gateway. On chipnet these come from
 * real key material and the remittance config the covenant is parameterised
 * with; here they only need to be stable and recognisably distinct.
 */

const PAYEE_PKH_BY_EMPLOYEE: Record<number, string | undefined> = {
  1001: '9c1d3f5a7b2e4c6d8f0a1b3c5d7e9f0a2b4c6d8e', // Maria Santos
  1002: '4e8a0c2d6f1b3a5c7e9d0f2a4b6c8d0e1f3a5b7c', // Jun Dela Cruz
};

const PAYEE_PKH_FALLBACK = '0000000000000000000000000000000000000001';

/** The 20-byte P2PKH hash carried at offset 0 of the employee's commitment. */
export function mockPayeePkhHex(employeeNo: number): string {
  return PAYEE_PKH_BY_EMPLOYEE[employeeNo] ?? PAYEE_PKH_FALLBACK;
}

/** Display addresses for the four statutory payees of every payroll tx. */
export const MOCK_AGENCIES = {
  sss: 'bchtest:qsss0remit…ra11199',
  philhealth: 'bchtest:qphic0remit…ra11223',
  pagibig: 'bchtest:qhdmf0remit…ra9679',
  bir: 'bchtest:qbir0remit…ra10963',
} as const;

/** Display form of an employee P2PKH from their pkh hex. */
export function pkhToMockAddress(pkhHex: string): string {
  return `bchtest:q${pkhHex.slice(0, 8)}…${pkhHex.slice(-4)}`;
}
