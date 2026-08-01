import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { authBackend, signInAsync } from '../auth/session'
import { DEMO_PASSWORD, ROLE_SHORT, USERS } from '../auth/users'
import { homeRouteFor } from '@ui/domain/navigation/esahodNavigation'

/**
 * Sign in.
 *
 * One column, one card, no imagery. The template's authentication screen puts
 * a full-height illustrated panel beside the form; that panel is decoration,
 * and on a sign-in page decoration competes with the only thing the visitor
 * came to do. What is left is the logo, two fields, and the demo credentials
 * a judge needs to get past it.
 *
 * The form is real: when Supabase is configured the password is checked by the
 * server and row-level security decides what the session can then read.
 * Offline it falls back to the bundled fixtures, and the line under the button
 * says which of the two is in force rather than leaving it to be assumed.
 */
export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const backend = authBackend()

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setError(null)
    setBusy(true)

    void signInAsync(email, password)
      .then(({ user, error: detail }) => {
        if (!user) {
          // Deliberately not "no such user" vs "wrong password" — the habit of
          // not confirming which half was right is worth keeping even here.
          // The server's own message shows only when it says something an
          // operator needs, like the project being unreachable.
          setError(
            detail && !/invalid login credentials/i.test(detail)
              ? `Sign-in failed: ${detail}`
              : 'Those credentials do not match an account.',
          )
          return
        }
        navigate(homeRouteFor(user.role), { replace: true })
      })
      .finally(() => setBusy(false))
  }

  const fill = (userEmail: string): void => {
    setEmail(userEmail)
    setPassword(DEMO_PASSWORD)
    setError(null)
  }

  return (
    <div className="d-flex align-items-center justify-content-center min-vh-100 p-3">
      <div className="w-100" style={{ maxWidth: 380 }}>
        <div className="text-center mb-4">
          <img alt="eSahod" src="/build/img/eSahod_logo.svg" style={{ maxHeight: 34 }} />
        </div>

        <form onSubmit={submit}>
          <div className="text-center mb-4">
            <h4 className="mb-1">Sign in</h4>
            <p className="fs-13 text-muted mb-0">Automated payroll on Bitcoin Cash</p>
          </div>

          {error ? (
            <div className="alert alert-danger d-flex align-items-center py-2" role="alert">
              <i className="ti ti-alert-triangle me-2"></i>
              <span className="fs-13">{error}</span>
            </div>
          ) : null}

          <div className="mb-3">
            <label className="form-label fs-13" htmlFor="login_email">
              Email
            </label>
            <input
              id="login_email"
              className="form-control"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@esahod.ph"
              required
            />
          </div>

          <div className="mb-3">
            <label className="form-label fs-13" htmlFor="login_password">
              Password
            </label>
            {/*
              The template toggles this from script.js by swapping a class on a
              sibling span. React owns this input, so the toggle is state here —
              otherwise the two contend over the same node on every re-render.
            */}
            <div className="input-group">
              <input
                id="login_password"
                className="form-control border-end-0"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="input-group-text border-start-0 bg-transparent"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <i className={showPassword ? 'ti ti-eye' : 'ti ti-eye-off'}></i>
              </button>
            </div>
          </div>

          <button className="btn btn-primary w-100 mb-3" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="d-flex flex-wrap justify-content-center gap-2">
            {USERS.map((user) => (
              <button
                key={user.id}
                type="button"
                className="btn btn-sm btn-light border"
                title={user.email}
                onClick={() => fill(user.email)}
              >
                {user.firstName} <span className="text-muted">· {ROLE_SHORT[user.role]}</span>
              </button>
            ))}
          </div>

          <p className="fs-12 text-muted text-center mt-3 mb-0">
            Demo password <code className="text-body">{DEMO_PASSWORD}</code>
            {backend === 'supabase' ? ' · verified by the server' : ' · offline demo accounts'}
          </p>
        </form>
      </div>
    </div>
  )
}
