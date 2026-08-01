import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { EMPLOYMENT_STATUS_ACTIVE } from '@domain/payroll/types'
import type { EmploymentCommitment } from '@domain/payroll/commitment'

/**
 * The handful of primitives the three screens share, written in the design
 * system's own vocabulary — `.card`, `.badge badge-soft-*`, `.alert` — rather
 * than in bespoke classes. Nothing here invents a style: each is the markup
 * the template already uses for the same job.
 */

export function PageHeader(props: {
  title: string
  section: string
  children?: ReactNode
}) {
  return (
    <div className="d-md-flex d-block align-items-center justify-content-between page-breadcrumb mb-3">
      <div className="my-auto mb-2">
        <h2 className="mb-1">{props.title}</h2>
        <nav>
          <ol className="breadcrumb mb-0">
            <li className="breadcrumb-item">
              <Link to="/treasurer">
                <i className="ti ti-smart-home"></i>
              </Link>
            </li>
            <li className="breadcrumb-item">{props.section}</li>
            <li aria-current="page" className="breadcrumb-item active">
              {props.title}
            </li>
          </ol>
        </nav>
      </div>
      {props.children ? (
        <div className="d-flex my-xl-auto right-content align-items-center flex-wrap">
          {props.children}
        </div>
      ) : null}
    </div>
  )
}

export function Card(props: { children: ReactNode; className?: string }) {
  return <div className={`card ${props.className ?? ''}`.trim()}>{props.children}</div>
}

export function CardHeader(props: { title: ReactNode; hint?: string; children?: ReactNode }) {
  return (
    <div className="card-header d-flex align-items-center justify-content-between flex-wrap row-gap-3">
      <div className="me-2">
        <h5 className="mb-0">{props.title}</h5>
        {props.hint ? <p className="fs-12 mb-0 mt-1 text-muted">{props.hint}</p> : null}
      </div>
      {props.children}
    </div>
  )
}

export function StatusBadge(props: { commitment: EmploymentCommitment }) {
  const { status, nextPeriod, endPeriod } = props.commitment
  const lapsed = nextPeriod > endPeriod

  if (status === EMPLOYMENT_STATUS_ACTIVE && !lapsed) {
    return (
      <span className="badge badge-soft-success badge-sm fw-normal">
        <i className="ti ti-circle-filled fs-5 me-1"></i>Active
      </span>
    )
  }
  if (status === EMPLOYMENT_STATUS_ACTIVE && lapsed) {
    return (
      <span className="badge badge-soft-warning badge-sm fw-normal">
        <i className="ti ti-circle-filled fs-5 me-1"></i>Lapsed
      </span>
    )
  }
  return (
    <span className="badge badge-soft-danger badge-sm fw-normal">
      <i className="ti ti-circle-filled fs-5 me-1"></i>Inactive
    </span>
  )
}

export function ErrorNote(props: { message: string | null }) {
  if (!props.message) return null
  return (
    <div className="alert alert-danger d-flex align-items-center mb-3" role="alert">
      <i className="ti ti-alert-triangle me-2"></i>
      <span>{props.message}</span>
    </div>
  )
}

export function Loading() {
  return (
    <div className="d-flex align-items-center justify-content-center py-5 text-muted">
      <div className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></div>
      Loading chain state…
    </div>
  )
}

/**
 * A labelled figure. Used for the treasury balance and the cut-off counters,
 * where the template's own dashboards use the same card-body / avatar pairing.
 */
export function StatTile(props: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon: string
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
}) {
  const tone = props.tone ?? 'primary'
  return (
    <div className="card">
      <div className="card-body">
        <div className="d-flex align-items-center justify-content-between">
          <div className="me-2 overflow-hidden">
            <p className="fs-12 fw-medium mb-1 text-truncate">{props.label}</p>
            <h4 className="mb-0">{props.value}</h4>
            {props.sub ? <p className="fs-12 mb-0 mt-1 text-muted">{props.sub}</p> : null}
          </div>
          <div className={`avatar avatar-lg bg-${tone}-transparent rounded-circle flex-shrink-0`}>
            <i className={`${props.icon} fs-20`}></i>
          </div>
        </div>
      </div>
    </div>
  )
}
