import { NavLink } from 'react-router'

export function AdminNav() {
  return (
    <nav className="filter-bar admin-nav" aria-label="Admin">
      <NavLink to="/admin" end className="filter-chip">
        Suggestions
      </NavLink>
      <NavLink to="/admin/members" className="filter-chip">
        Members
      </NavLink>
    </nav>
  )
}
