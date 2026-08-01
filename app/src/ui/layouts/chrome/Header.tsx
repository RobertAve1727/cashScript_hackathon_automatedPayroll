import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signOut, useSession } from '../../../auth/session'
import { ROLE_LABEL } from '../../../auth/users'
import { homeRouteFor, LOGIN_ROUTE } from '@ui/domain/navigation/esahodNavigation'
import { useAppServices } from '@ui/providers/AppServicesProvider'
import type { ThemeMode } from '@ui/domain/theme/ThemeSettings'

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

  return (
    <Fragment>
      <div className="header">
        <div className="main-header">
          <div className="header-left">
            <Link to={homeRouteFor(user?.role ?? null)} className="logo">
              <img alt="eSahod" src="/build/img/logo.svg" />
            </Link>{' '}
            <Link to={homeRouteFor(user?.role ?? null)} className="dark-logo">
              <img alt="eSahod" src="/build/img/logo-white.svg" />
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
                <a className="btn btn-menubar me-2" href="javascript:void(0);" id="toggle_btn">
                  <i className="ti ti-arrow-bar-to-left"></i>
                </a>{' '}
                <span className="d-none d-md-inline-flex align-items-center text-muted fs-13">
                  <i className="ti ti-circle-filled fs-8 text-success me-2"></i>
                  Philippine private sector — SSS, PhilHealth, Pag-IBIG, BIR
                </span>
              </div>{' '}
              <div className="d-flex align-items-center gap-2">
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
