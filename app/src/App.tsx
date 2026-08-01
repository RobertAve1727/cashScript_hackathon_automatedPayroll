import { useEffect, useState } from 'react';

import { EmployeeScreen } from './screens/EmployeeScreen';
import { HrScreen } from './screens/HrScreen';
import { TreasurerScreen } from './screens/TreasurerScreen';

/**
 * A tiny hash router — three judge-facing screens, zero dependencies.
 * Routes: #/treasurer, #/hr, #/employee.
 */

type Route = '/treasurer' | '/hr' | '/employee';

const ROUTES: readonly { path: Route; label: string; blurb: string }[] = [
  { path: '/treasurer', label: 'Treasurer', blurb: 'run payroll, powerlessly' },
  { path: '/hr', label: 'HR', blurb: 'issue & amend employment NFTs' },
  { path: '/employee', label: 'Employee', blurb: 'the payslip, reconciled' },
];

function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '');
  return ROUTES.some((route) => route.path === hash) ? (hash as Route) : '/treasurer';
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);
  useEffect(() => {
    const onChange = (): void => setRoute(currentRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function App() {
  const route = useHashRoute();

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-flag-yellow">e</span>
            <span className="text-slate-100">Sahod</span>
          </h1>
          <p className="text-xs text-slate-500">
            Automated PH private-sector payroll on Bitcoin Cash — net pay and every statutory
            remittance in one atomic transaction.
          </p>
        </div>
        <nav className="flex gap-1 rounded-xl border border-slate-800 bg-slate-900/70 p-1">
          {ROUTES.map((item) => (
            <a
              key={item.path}
              href={`#${item.path}`}
              title={item.blurb}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                route === item.path
                  ? 'bg-flag-blue text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <main>
        {route === '/treasurer' ? <TreasurerScreen /> : null}
        {route === '/hr' ? <HrScreen /> : null}
        {route === '/employee' ? <EmployeeScreen /> : null}
      </main>

      <footer className="mt-12 border-t border-slate-800 pt-4 text-xs text-slate-600">
        ePHP CashTokens on chipnet · SSS RA 11199 · PhilHealth RA 11223 · Pag-IBIG RA 9679 · BIR
        RA 10963 (TRAIN) · every figure on this page is computed by the same statutory engine the
        covenant is tested against.
      </footer>
    </div>
  );
}
