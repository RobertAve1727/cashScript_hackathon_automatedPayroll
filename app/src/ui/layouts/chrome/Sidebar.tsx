import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useMenuState } from '../useMenuState'
import { useSession } from '../../../auth/session'
import { homeRouteFor, sectionsFor } from '@ui/domain/navigation/esahodNavigation'
import { ROLE_LABEL } from '../../../auth/users'

/**
 * The vertical sidebar, in the SmartHR template's own markup.
 *
 * Structure, class names and the `menuClass`/`submenuStyle` binding are the
 * template's; the contents are this project's. The original listed 283 routes
 * across a dozen collapsible groups, every one of which would be a dead link
 * here, so the menu is built from the navigation data — filtered to what the
 * signed-in role may actually open, which means a forbidden page is never even
 * offered.
 */
export default function Sidebar() {
  const { menuClass, submenuStyle } = useMenuState()
  const user = useSession()
  const sections = sectionsFor(user?.role ?? null)
  const home = homeRouteFor(user?.role ?? null)

  return (
    <Fragment>
      <div className="sidebar" id="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <Link to={home} className="logo logo-normal">
            <img alt="eSahod" src="/build/img/eSahod_logo.svg" />
          </Link>{' '}
          <Link to={home} className="logo-small">
            <img alt="eSahod" src="/build/img/eSahod_logo_small.svg" />
          </Link>{' '}
          <Link to={home} className="dark-logo">
            <img alt="eSahod" src="/build/img/eSahod_logo_white.svg" />
          </Link>
        </div>
        {/* /Logo */}{' '}
        {user ? (
          <div className="sidebar-header p-3 pb-0 pt-2">
            <div className="text-center rounded bg-light p-2 mb-3 sidebar-profile d-flex align-items-center">
              <div className="avatar avatar-md bg-primary-transparent rounded-circle d-flex align-items-center justify-content-center flex-shrink-0">
                <span className="fw-medium">{initials(user.name)}</span>
              </div>
              <div className="text-start sidebar-profile-info ms-2 overflow-hidden">
                <h6 className="fs-12 fw-normal mb-0 text-truncate">{user.name}</h6>
                <p className="fs-10 mb-0 text-truncate">{ROLE_LABEL[user.role]}</p>
              </div>
            </div>
          </div>
        ) : null}
        <div className="sidebar-inner slimscroll" data-simplebar="init">
          <div className="sidebar-menu" id="sidebar-menu">
            <ul>
              {sections.map((group) => {
                const paths = group.routes.map((route) => route.path)
                return (
                  <Fragment key={group.section}>
                    <li className="menu-title">
                      <span>{group.section.toUpperCase()}</span>
                    </li>
                    <li>
                      <ul>
                        <li className={menuClass('submenu', paths, 'subdrop')}>
                          <a href="javascript:void(0);" className={menuClass('', paths, 'subdrop')}>
                            <i className={group.routes[0]!.icon}></i> <span>{group.section}</span>{' '}
                            <span className="menu-arrow"></span>
                          </a>
                          <ul style={submenuStyle(paths)}>
                            {group.routes.map((route) => (
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
                  </Fragment>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
    </Fragment>
  )
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
}
