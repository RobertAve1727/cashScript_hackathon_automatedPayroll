import { Fragment } from 'react'

/**
 * The template's footer markup, carrying this project's own wording.
 */
export default function Footer() {
  return (
    <Fragment>
      <div className="footer d-sm-flex align-items-center justify-content-between border-top bg-white p-3">
        <p className="mb-0">
          eSahod — automated Philippine payroll on Bitcoin Cash CashTokens.
        </p>{' '}
        <p className="mb-0 text-muted">
          Net pay and every statutory remittance in one atomic transaction.
        </p>
      </div>
    </Fragment>
  )
}
