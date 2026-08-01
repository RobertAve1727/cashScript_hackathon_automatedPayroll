import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { HOME_ROUTE } from '@ui/domain/navigation/esahodNavigation'
import { useAppServices } from '@ui/providers/AppServicesProvider'
import { PageHost } from './routes/PageHost'
import { PAGE_ROUTES } from './routes/pageManifest'

/**
 * One route per screen. Components load lazily through the manifest, so a
 * visit downloads only the screen it needs.
 */
export default function App() {
  const { theme } = useAppServices()

  // Apply the persisted theme before the first paint of the shell.
  useEffect(() => {
    theme.restore()
  }, [theme])

  return (
    <Routes>
      <Route path="/" element={<Navigate replace to={HOME_ROUTE} />} />
      {PAGE_ROUTES.map((page) => (
        <Route key={page.route} path={page.route} element={<PageHost page={page} />} />
      ))}
      <Route path="*" element={<Navigate replace to={HOME_ROUTE} />} />
    </Routes>
  )
}
