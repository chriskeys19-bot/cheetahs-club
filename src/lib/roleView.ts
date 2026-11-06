import { isClubRole, type ClubRole } from './types.ts'

const STORAGE_KEY = 'cheetahs.role-view'
const DEFAULT_EMAILS = 'chriskeys19@gmail.com'

export function roleSwitchEmails(): string[] {
  const configured = import.meta.env.VITE_ROLE_SWITCH_EMAILS
  const source = typeof configured === 'string' && configured.trim().length > 0 ? configured : DEFAULT_EMAILS
  const emails: string[] = []
  for (const part of source.split(',')) {
    const email = part.trim().toLowerCase()
    if (email.length > 0 && !emails.includes(email)) emails.push(email)
  }
  return emails
}

export function canSwitchRole(email: string | null | undefined): boolean {
  if (!email) return false
  return roleSwitchEmails().includes(email.trim().toLowerCase())
}

export function readStoredViewRole(): ClubRole | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isClubRole(value) ? value : null
  } catch {
    return null
  }
}

export function writeStoredViewRole(role: ClubRole | null): void {
  try {
    if (role === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, role)
  } catch {
    // Private browsing can reject storage. The in-memory choice still applies.
  }
}
