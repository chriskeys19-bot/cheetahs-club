import { useAuth } from '../auth/useAuth.ts'
import { CLUB_ROLES, roleLabel, type ClubRole } from '../lib/types.ts'

export function RoleSwitcher({ placement }: { placement: 'header' | 'menu' }) {
  const { canSwitchRole: allowed, accountProfile, viewRole, setViewRole } = useAuth()
  if (!allowed || !accountProfile) return null

  const selected = viewRole ?? accountProfile.role

  function choose(role: ClubRole) {
    setViewRole(role === accountProfile?.role ? null : role)
  }

  return (
    <div className={`role-switch role-switch-${placement}`} role="group" aria-label="View as">
      <span className="role-switch-label">View as</span>
      {CLUB_ROLES.map((role) => (
        <button
          key={role}
          type="button"
          className="role-switch-option"
          aria-pressed={selected === role}
          onClick={() => choose(role)}
        >
          {roleLabel(role)}
        </button>
      ))}
    </div>
  )
}
