import type { ReactNode } from 'react'
import Header from './chrome/Header'
import Sidebar from './chrome/Sidebar'
import Footer from './chrome/Footer'

/**
 * The admin shell every eSahod screen renders inside.
 *
 * The SmartHR original mounted four sidebars at once — vertical, horizontal,
 * stacked and two-column — because its theme customiser switches between them
 * purely with CSS. Each carried the full 283-route menu, roughly 2,500 lines
 * apiece. Only the vertical sidebar is shipped here: the other three are
 * variants of a navigation this app does not have, and mounting them would put
 * four copies of a dead menu in the DOM on every page.
 */
export function MainLayout({
  children,
  hasFooter,
}: {
  children: ReactNode
  hasFooter: boolean
}) {
  return (
    <div className="main-wrapper">
      <Header />
      <Sidebar />
      <div className="page-wrapper">
        {children}
        {hasFooter ? <Footer /> : null}
      </div>
    </div>
  )
}
