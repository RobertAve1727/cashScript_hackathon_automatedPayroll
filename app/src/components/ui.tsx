import type { ReactNode } from 'react';

import { EMPLOYMENT_STATUS_ACTIVE } from '@domain/payroll/types';
import type { EmploymentCommitment } from '@domain/payroll/commitment';

export function Card(props: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg shadow-black/20 ${props.className ?? ''}`}
    >
      {props.children}
    </section>
  );
}

export function SectionTitle(props: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold tracking-widest text-slate-400 uppercase">
        {props.children}
      </h2>
      {props.hint ? <p className="mt-1 text-xs text-slate-500">{props.hint}</p> : null}
    </div>
  );
}

export function StatusBadge(props: { commitment: EmploymentCommitment }) {
  const { status, nextPeriod, endPeriod } = props.commitment;
  const lapsed = nextPeriod > endPeriod;

  if (status === EMPLOYMENT_STATUS_ACTIVE && !lapsed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
      </span>
    );
  }
  if (status === EMPLOYMENT_STATUS_ACTIVE && lapsed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Lapsed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-flag-red/15 px-2.5 py-0.5 text-xs font-medium text-red-300">
      <span className="h-1.5 w-1.5 rounded-full bg-flag-red" /> Inactive
    </span>
  );
}

export function ErrorNote(props: { message: string | null }) {
  if (!props.message) return null;
  return (
    <div className="rounded-lg border border-flag-red/40 bg-flag-red/10 px-4 py-2.5 text-sm text-red-200">
      {props.message}
    </div>
  );
}

export function Loading() {
  return <p className="p-8 text-sm text-slate-500">Loading chain state…</p>;
}
