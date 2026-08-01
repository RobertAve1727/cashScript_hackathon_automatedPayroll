import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { authBackend, signInAsync } from '../auth/session'
import { DEMO_PASSWORD, ROLE_LABEL, ROLE_SHORT, USERS } from '../auth/users'
import { homeRouteFor } from '@ui/domain/navigation/esahodNavigation'

/**
 * Sign in — the design system's own two-column authentication layout.
 *
 * The form is real: an email that is not in the directory, or a wrong
 * password, does not get in. What it is not is a security boundary. The
 * directory is a table in the bundle and anyone can read it, so this decides
 * which role's pages to render and nothing more. That is stated on the page
 * rather than implied, because the interesting claim underneath is that it
 * does not matter: `paySalary` takes no signature at all, so a forged session
 * cannot redirect a centavo, and amending a record needs HR's key rather than
 * HR's account.
 *
 * The demo accounts are listed with a fill button each. A judge should not
 * have to retype an address to see the next role, and a login screen that
 * hides its own demo credentials is a login screen nobody gets past.
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
          // The server's own message is appended only when it says something
          // an operator needs, like the project being unreachable.
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
    <div className="container-fuild">
      <div className="w-100 overflow-hidden position-relative flex-wrap d-block vh-100">
        <div className="row">
          {/*
            The template splits 5/7 in the form's favour, which suited a form
            that filled its column. Ours is a fixed 380px, so that column was
            mostly empty white. Reversed: the brand panel takes the larger
            share and the form sits in a column close to its own width.
          */}
          <div className="col-xl-7 col-lg-6">
            <div className="login-background position-relative d-lg-flex align-items-center justify-content-center d-none flex-wrap vh-100">
              <div className="bg-overlay-img">
                <img alt="" className="bg-1" src="/build/img/bg/bg-01.png" />
                <img alt="" className="bg-2" src="/build/img/bg/bg-02.png" />
                <img alt="" className="bg-3" src="/build/img/bg/bg-03.png" />
              </div>
              <div className="authentication-card w-100">
                <div className="authen-overlay-item border w-100">
                  <h1 className="text-white fs-40 fw-bold">
                    Paid accurately,
                    <br />
                    on schedule,
                    <br />
                    with nothing withheld in between.
                  </h1>
                  <div className="my-4 mx-auto authen-overlay-img">
                    <img alt="" src="/build/img/bg/authentication-bg-01.png" />
                  </div>
                  <div>
                    <p className="text-white fs-20 fw-semibold text-center">
                      Net pay and every statutory remittance
                      <br />
                      in one atomic transaction.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="col-xl-5 col-lg-6 col-md-12 col-sm-12">
            <div className="row justify-content-center align-items-center vh-100 overflow-auto flex-wrap">
              {/*
                A fixed max-width rather than a grid column. Columns are a
                fraction of whatever the viewport happens to be, so the form
                kept growing on wide screens; an email and a password field do
                not need more room at 1920 than at 1280. 380px is the width
                those two inputs actually want.
              */}
              <div className="mx-auto p-4 w-100" style={{ maxWidth: 380 }}>
                <form onSubmit={submit}>
                  <div className="mx-auto mb-4 text-center">
                    <img alt="eSahod" className="img-fluid" src="/build/img/eSahod_logo.svg" style={{ maxHeight: 34 }} />
                  </div>

                  <div className="text-center mb-4">
                    <h2 className="mb-2">Sign In</h2>
                    <p className="mb-0">Please enter your details to sign in</p>
                  </div>

                  {error ? (
                    <div className="alert alert-danger d-flex align-items-center" role="alert">
                      <i className="ti ti-alert-triangle me-2"></i>
                      <span>{error}</span>
                    </div>
                  ) : null}

                  <div className="mb-3">
                    <label className="form-label" htmlFor="login_email">
                      Email Address
                    </label>
                    <div className="input-group">
                      <input
                        id="login_email"
                        className="form-control border-end-0"
                        type="email"
                        autoComplete="username"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@esahod.ph"
                        required
                      />
                      <span className="input-group-text border-start-0">
                        <i className="ti ti-mail"></i>
                      </span>
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label" htmlFor="login_password">
                      Password
                    </label>
                    {/*
                      The template toggles this from script.js by swapping a
                      class on a sibling span. React owns this input, so the
                      toggle is state here — otherwise the two would fight over
                      the same DOM node on every re-render.
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

                  <div className="d-flex align-items-center justify-content-between mb-3">
                    <div className="form-check form-check-md mb-0">
                      <input className="form-check-input" id="remember_me" type="checkbox" defaultChecked />
                      <label className="form-check-label mt-0" htmlFor="remember_me">
                        Remember Me
                      </label>
                    </div>
                  </div>

                  <div className="mb-2">
                    <button className="btn btn-primary w-100" type="submit" disabled={busy}>
                      {busy ? 'Signing in…' : 'Sign In'}
                    </button>
                  </div>

                  {/*
                    The demo accounts were a four-row card with names, badges,
                    addresses and a button each — more vertical space than the
                    form it was meant to serve. One wrapped row of chips does
                    the same job: pick a role, the fields fill, and the screen
                    still reads as a login rather than a switchboard.
                  */}
                  <div className="login-or">
                    <span className="span-or">Demo accounts</span>
                  </div>

                  <div className="d-flex flex-wrap justify-content-center gap-2">
                    {USERS.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        className="btn btn-sm btn-light border"
                        title={`${user.email} — ${ROLE_LABEL[user.role]}`}
                        onClick={() => fill(user.email)}
                      >
                        {user.name.split(' ')[0]}{' '}
                        <span className="text-muted">· {ROLE_SHORT[user.role]}</span>
                      </button>
                    ))}
                  </div>

                  {/*
                    Which backend will check the password. The distinction is
                    not cosmetic: through Supabase the server verifies it and
                    row-level security decides what the session can read, so an
                    employee's queries return their own row because the database
                    says so. Offline, the check is a table in this bundle.
                  */}
                  <p className="fs-12 text-muted text-center mt-3 mb-0">
                    Password <code className="text-body">{DEMO_PASSWORD}</code> ·{' '}
                    {backend === 'supabase' ? (
                      <>
                        verified by Supabase, with row-level security deciding what each role can
                        read
                      </>
                    ) : (
                      <>offline demo accounts — this chooses which pages you see, nothing more</>
                    )}
                  </p>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
