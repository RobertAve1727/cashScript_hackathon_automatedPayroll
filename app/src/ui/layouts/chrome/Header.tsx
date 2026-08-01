import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signOut, useSession } from '../../../auth/session'
import { ROLE_LABEL } from '../../../auth/users'
import { homeRouteFor, LOGIN_ROUTE } from '@ui/domain/navigation/esahodNavigation'
import { useAppServices } from '@ui/providers/AppServicesProvider'
import type { ThemeMode } from '@ui/domain/theme/ThemeSettings'
import { toggleProofView, useProofView } from '../../../view/proof-view'
import { clear, STORAGE_KEYS } from '../../../chain/persistence'
import { useChainMode, type ChainMode } from '../../../chain/active-gateway'

/**
 * The top bar, in the SmartHR template's own markup.
 *
 * Trimmed the same way as the sidebar: the original carried a CRM mega-menu, a
 * global search and chat/mail/notification dropdowns, all pointing at routes
 * this app does not ship. What remains is what still does something — the
 * sidebar collapse (`#toggle_btn` and `#mobile_btn`, driven by the template's
 * own script.js), a working light/dark switch, and the signed-in user.
 *
 * The switch goes through the template's ThemeCustomizationService rather than
 * toggling a class, so the choice persists and is restored before first paint
 * by theme-script.js — exactly as the customiser panel did.
 */
export default function Header() {
  const { theme } = useAppServices()
  const [mode, setMode] = useState<ThemeMode>(() => theme.getSettings().theme)
  const user = useSession()
  const proofView = useProofView()
  const chain = useChainMode()
  const navigate = useNavigate()

  // The service is the source of truth; theme-script.js may have restored a
  // persisted value before React mounted.
  useEffect(() => {
    setMode(theme.getSettings().theme)
  }, [theme])

  const toggleTheme = (): void => {
    const next: ThemeMode = mode === 'dark' ? 'light' : 'dark'
    theme.update('theme', next)
    setMode(next)
  }

  const leave = (): void => {
    signOut()
    navigate(LOGIN_ROUTE, { replace: true })
  }

  /**
   * Back to the seeded fixtures.
   *
   * Reloads rather than reseeding in place: both gateways are module-level
   * singletons built once at import, so clearing storage without a reload
   * would leave the old objects in memory and the screens unchanged — the
   * button would appear to do nothing until the next refresh.
   */
  const reset = (): void => {
    const ok = window.confirm(
      'Reset the demo?\n\nThis clears every payroll run, amendment and attendance record, and puts the treasury and both employees back to their starting state.',
    )
    if (!ok) return

    clear([STORAGE_KEYS.chain, STORAGE_KEYS.attendance])
    window.location.reload()
  }

  return (
    <Fragment>
      <div className="header">
        <div className="main-header">
          <div className="header-left">
            <Link to={homeRouteFor(user?.role ?? null)} className="logo">
              <img alt="eSahod" src="/build/img/eSahod_logo.svg" />
            </Link>{' '}
            <Link to={homeRouteFor(user?.role ?? null)} className="dark-logo">
              <img alt="eSahod" src="/build/img/eSahod_logo_white.svg" />
            </Link>
          </div>{' '}
          <a className="mobile_btn" href="#sidebar" id="mobile_btn">
            <span className="bar-icon">
              <span></span> <span></span> <span></span>
            </span>
          </a>{' '}
          <div className="header-user">
            <div className="nav user-menu nav-list">
              <div className="me-auto d-flex align-items-center" id="header-search">
                {/* script.js binds the sidebar collapse by id, so the element only
                    has to exist and carry it — see the note in Sidebar on the
                    `javascript:` scheme. */}
                <a
                  className="btn btn-menubar me-2"
                  href="#"
                  onClick={(event) => event.preventDefault()}
                  id="toggle_btn"
                >
                  <i className="ti ti-arrow-bar-to-left"></i>
                </a>{' '}
                {/*
                  Which chain the figures came from. Stated in the chrome
                  rather than a page, because "is this real?" is the first
                  question anyone asks and the answer should not depend on
                  which screen they happen to be on.
                */}
                <span className="d-none d-md-inline-flex align-items-center fs-13">
                  <i className={`ti ti-circle-filled fs-8 me-2 ${chainTone(chain.kind)}`}></i>
                  <span className="text-muted">{chainLabel(chain)}</span>
                </span>
              </div>{' '}
              <div className="d-flex align-items-center gap-2">
                {/*
                  Proof view. A labelled switch rather than another icon button:
                  the two states are not obvious from an icon alone, and this is
                  the control that decides whether the app reads as a payroll
                  system or as a protocol demo.
                */}
                <div
                  className="form-check form-switch d-none d-md-flex align-items-center mb-0 me-1"
                  title="Reveal the 40-byte commitments, OP_RETURN payloads and anchor transactions behind every figure"
                >
                  <input
                    className="form-check-input mt-0"
                    type="checkbox"
                    role="switch"
                    id="proof_view_switch"
                    checked={proofView}
                    onChange={toggleProofView}
                  />
                  <label className="form-check-label fs-12 ms-2 text-nowrap" htmlFor="proof_view_switch">
                    Proof view
                  </label>
                </div>
                {/* Icon-only below md, where the label does not fit. */}
                <button
                  type="button"
                  className={`btn btn-menubar d-md-none ${proofView ? 'active' : ''}`}
                  onClick={toggleProofView}
                  title={proofView ? 'Hide the bytes' : 'Show the bytes'}
                >
                  <i className="ti ti-binary"></i>
                </button>
                <button
                  type="button"
                  className="btn btn-menubar"
                  onClick={toggleTheme}
                  title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  <i className={mode === 'dark' ? 'ti ti-sun' : 'ti ti-moon'}></i>
                </button>
                {user ? (
                  <Fragment>
                    <button
                      type="button"
                      className="btn btn-menubar"
                      onClick={reset}
                      title="Reset the demo to its starting state"
                    >
                      <i className="ti ti-refresh"></i>
                    </button>
                    <span className="d-none d-sm-block text-end lh-sm">
                      <span className="d-block fw-medium fs-13">{user.name}</span>
                      <span className="d-block fs-11 text-muted">{ROLE_LABEL[user.role]}</span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-menubar"
                      onClick={leave}
                      title="Sign out"
                    >
                      <i className="ti ti-logout"></i>
                    </button>
                  </Fragment>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Fragment>
  )
}

function chainTone(kind: ChainMode['kind']): string {
  if (kind === 'chipnet') return 'text-success'
  if (kind === 'error') return 'text-danger'
  if (kind === 'connecting') return 'text-warning'
  return 'text-secondary'
}

function chainLabel(chain: ChainMode): string {
  switch (chain.kind) {
    case 'chipnet':
      return 'Live on chipnet'
    case 'connecting':
      return 'Connecting to chipnet…'
    case 'error':
      return 'Chipnet unreachable — showing demo data'
    default:
      return 'Demo data — not connected to a network'
  }
}
