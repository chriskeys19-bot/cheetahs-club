import { roleLabel, type ClubRole } from '../lib/types.ts'

export function RoleBadge({ role }: { role: ClubRole | null }) {
  if (!role) {
    return <span className="role-badge role-pending">Member</span>
  }
  return <span className={`role-badge role-${role}`}>{roleLabel(role)}</span>
}
