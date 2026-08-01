import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { canAccess, useSession } from './auth/session'
import { homeRouteFor, LOGIN_ROUTE } from '@ui/domain/navigation/esahodNavigation'
import { useAppServices } from '@ui/providers/AppServicesProvider'
import { PageHost } from './routes/PageHost'
import { PAGE_ROUTES, type PageRoute } from './routes/pageManifest'

/**
 * One route per screen, gated by role.
 *
 * A page whose `roles` the signed-in user does not hold redirects to that
 * user's own landing page rather than rendering an error: the menu never
 * offers a forbidden route, so arriving at one means a stale bookmark or a
 * hand-typed URL, and the useful response is to put the person somewhere they
 * belong. Components load lazily through the manifest, so a visit downloads
 * only the screen it needs.
 */
export default function App() {
  const { theme } = useAppServices()
  const user = useSession()

  // Apply the persisted theme before the first paint of the shell.
  useEffect(() => {
    theme.restore()
  }, [theme])

  const home = homeRouteFor(user?.role ?? null)

  const element = (page: PageRoute) => {
    const isPublic = page.roles.length === 0

    if (isPublic) {
      // Signing in again while already signed in just goes home.
      return user === null ? <PageHost page={page} /> : <Navigate replace to={home} />
    }
    if (user === null) return <Navigate replace to={LOGIN_ROUTE} />
    if (!canAccess(user, page.roles)) return <Navigate replace to={home} />

    return <PageHost page={page} />
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate replace to={home} />} />
      {PAGE_ROUTES.map((page) => (
        <Route key={page.route} path={page.route} element={element(page)} />
      ))}
      <Route path="*" element={<Navigate replace to={home} />} />
    </Routes>
  )
}
