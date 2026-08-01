/// <reference types="vite/client" />

/**
 * Typed build-time configuration. Everything here is optional on purpose —
 * the app must run with none of it set (see `src/wallet/paytaca.ts`).
 */
interface ImportMetaEnv {
  /** WalletConnect Cloud project id — free at cloud.walletconnect.com. */
  readonly VITE_WC_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
