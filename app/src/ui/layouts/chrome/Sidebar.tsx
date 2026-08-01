import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useMenuState } from '../useMenuState'
import { ESAHOD_ROUTES } from '@ui/domain/navigation/esahodNavigation'

/**
 * The vertical sidebar, in the SmartHR template's own markup.
 *
 * Structure, class names and the `menuClass`/`submenuStyle` binding are the
 * template's; only the menu contents are this project's. The original listed
 * 283 routes across a dozen collapsible groups — every one of them would be a
 * dead link here, so the menu carries the three eSahod screens and nothing
 * else. The demo profile card, the "Search in HRMS" box and the chat/inbox
 * shortcuts are dropped for the same reason: they pointed at pages that do
 * not exist in this app.
 */
export default function Sidebar() {
  const { menuClass, submenuStyle } = useMenuState()
  const allRoutes = ESAHOD_ROUTES.map((route) => route.path)

  return (
    <Fragment>
      <div className="sidebar" id="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <Link to={ESAHOD_ROUTES[0].path} className="logo logo-normal">
            <img alt="eSahod" src="/build/img/logo.svg" />
          </Link>{' '}
          <Link to={ESAHOD_ROUTES[0].path} className="logo-small">
            <img alt="eSahod" src="/build/img/logo-small.svg" />
          </Link>{' '}
          <Link to={ESAHOD_ROUTES[0].path} className="dark-logo">
            <img alt="eSahod" src="/build/img/logo-white.svg" />
          </Link>
        </div>
        {/* /Logo */}{' '}
        <div className="sidebar-inner slimscroll" data-simplebar="init">
          <div className="sidebar-menu" id="sidebar-menu">
            <ul>
              <li className="menu-title">
                <span>PAYROLL</span>
              </li>{' '}
              <li>
                <ul>
                  <li className={menuClass('submenu', allRoutes, 'subdrop')}>
                    <a href="javascript:void(0);" className={menuClass('', allRoutes, 'subdrop')}>
                      <i className="ti ti-cash-banknote"></i> <span>eSahod</span>{' '}
                      <span className="badge badge-danger fs-10 fw-medium text-white p-1">
                        Chipnet
                      </span>{' '}
                      <span className="menu-arrow"></span>
                    </a>{' '}
                    <ul style={submenuStyle(allRoutes)}>
                      {ESAHOD_ROUTES.map((route) => (
                        <li key={route.path}>
                          <Link to={route.path} className={menuClass('', [route.path])}>
                            {route.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                </ul>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Fragment>
  )
}
