import { Fragment } from 'react'

/**
 * The template's footer markup, carrying this project's own wording. The
 * SmartHR attribution stays because the design system is theirs.
 */
export default function Footer() {
  return (
    <Fragment>
      <div className="footer d-sm-flex align-items-center justify-content-between border-top bg-white p-3">
        <p className="mb-0">
          eSahod — automated Philippine payroll on Bitcoin Cash CashTokens.
        </p>{' '}
        <p className="mb-0">
          UI on the{' '}
          <a
            className="text-primary"
            href="https://smarthr.dreamstechnologies.com/"
            rel="noreferrer"
            target="_blank"
          >
            SmartHR
          </a>{' '}
          design system
        </p>
      </div>
    </Fragment>
  )
}
