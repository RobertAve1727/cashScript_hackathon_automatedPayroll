import { useNavigate } from 'react-router-dom'
import { signIn } from '../auth/session'
import { ROLE_LABEL, USERS } from '../auth/users'
import { homeRouteFor } from '@ui/domain/navigation/esahodNavigation'

/**
 * Sign in by picking a role.
 *
 * There is no password field, and that is a deliberate choice rather than an
 * unfinished one. A password box with no backend behind it would be theatre —
 * it would imply a security boundary this demo does not have and cannot honour.
 * Picking an account states plainly what the screen actually does: choose which
 * role's pages to show.
 *
 * The blurb under each name tells a judge what they will see, so the demo does
 * not depend on someone remembering which fixture is the minimum-wage earner.
 */
export default function LoginPage() {
  const navigate = useNavigate()

  const enter = (userId: string): void => {
    const user = signIn(userId)
    if (user) navigate(homeRouteFor(user.role), { replace: true })
  }

  return (
    <div className="container-fluid">
      <div className="row vh-100 align-items-center justify-content-center">
        <div className="col-xxl-8 col-xl-9 col-lg-11 py-5">
          <div className="text-center mb-4">
            <img alt="eSahod" src="/build/img/logo.svg" className="img-fluid mb-4" style={{ maxHeight: 42 }} />
            <h3 className="mb-1">Automated payroll on Bitcoin Cash</h3>
            <p className="text-muted mb-0">
              Net pay and every statutory remittance in one atomic transaction. Choose a role to
              begin — no password, because there is no server to hold one.
            </p>
          </div>

          <div className="row g-3">
            {USERS.map((user) => (
              <div className="col-md-6" key={user.id}>
                <button
                  type="button"
                  className="card mb-0 w-100 h-100 text-start border"
                  onClick={() => enter(user.id)}
                >
                  <div className="card-body d-flex align-items-start">
                    <div className="avatar avatar-lg bg-primary-transparent rounded-circle d-flex align-items-center justify-content-center flex-shrink-0 me-3">
                      <i className={`${iconFor(user.role)} fs-20`}></i>
                    </div>
                    <div className="overflow-hidden">
                      <div className="d-flex align-items-center flex-wrap gap-2 mb-1">
                        <h6 className="mb-0">{user.name}</h6>
                        <span className="badge badge-soft-primary badge-sm fw-normal">
                          {ROLE_LABEL[user.role]}
                        </span>
                      </div>
                      <p className="fs-12 mb-1 text-muted">
                        {user.title}
                        {user.employeeNo === undefined ? '' : ` · Employee #${user.employeeNo}`}
                      </p>
                      <p className="fs-12 mb-0">{user.blurb}</p>
                    </div>
                  </div>
                </button>
              </div>
            ))}
          </div>

          <p className="fs-12 text-muted text-center mt-4 mb-0">
            These accounts choose which pages you see, not what the chain will accept.
            <code className="mx-1">paySalary</code> takes no signature at all, so a forged session
            cannot redirect a centavo, and amending a record needs HR&rsquo;s key rather than
            HR&rsquo;s account.
          </p>
        </div>
      </div>
    </div>
  )
}

function iconFor(role: string): string {
  if (role === 'hr') return 'ti ti-users'
  if (role === 'treasurer') return 'ti ti-building-bank'
  return 'ti ti-user'
}
