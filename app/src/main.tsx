import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppServicesProvider } from '@ui/providers/AppServicesProvider'
import App from './App'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('index.html is missing #root')

/**
 * StrictMode is intentionally omitted, as it is in the design system's own
 * entry point. It double-invokes effects in development, which would evaluate
 * the template's vendor scripts twice per navigation and leave duplicated
 * widgets behind — a development-only divergence from how the UI behaves in
 * production.
 */
createRoot(rootElement).render(
  <AppServicesProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </AppServicesProvider>,
)
