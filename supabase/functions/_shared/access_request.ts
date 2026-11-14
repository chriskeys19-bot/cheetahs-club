// Pure checks for the public access-request flow. request-access,
// finish-google-signin, and the unit tests all use this file. The database
// RPCs are what actually grant or refuse access.

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SignupInput = {
  email: string
  fullName: string
  password: string
  teamIds: string[]
  note: string | null
}

export type SignupChoice = {
  teamIds: string[]
  note: string | null
  fullName: string | null
}

export type ClubMessage = {
  subject: string
  text: string
  html: string
}

function withoutControls(value: string): string {
  let cleaned = ''
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    cleaned += code >= 32 && code !== 127 ? value.charAt(index) : ' '
  }
  return cleaned
}

export function cleanPersonName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = withoutControls(value).trim().replace(/\s+/g, ' ')
  if (name.length < 1 || name.length > 80) return null
  return name
}

export function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) return null
  return email
}

export function passwordProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 8 || value.length > 72) {
    return 'Use a password of 8 to 72 characters.'
  }
  return null
}

export function cleanNote(value: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (value == null || value === '') return { ok: true, note: null }
  if (typeof value !== 'string') return { ok: false, error: 'The note could not be read.' }
  const note = withoutControls(value).trim().replace(/[ ]{2,}/g, ' ')
  if (!note) return { ok: true, note: null }
  if (note.length > 500) return { ok: false, error: 'Keep the note to 500 characters.' }
  return { ok: true, note }
}

export function cleanTeamIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    const id = item.trim().toLowerCase()
    if (!UUID_PATTERN.test(id)) return null
    if (!ids.includes(id)) ids.push(id)
  }
  if (ids.length < 1) return null
  return ids
}

export function parseSignupInput(body: unknown): { ok: true; value: SignupInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Send JSON.' }
  const record = body as Record<string, unknown>
  const email = cleanEmail(record.email)
  if (!email) return { ok: false, error: 'Enter a valid email address.' }
  const fullName = cleanPersonName(record.full_name)
  if (!fullName) return { ok: false, error: 'Enter your full name.' }
  const passwordError = passwordProblem(record.password)
  if (passwordError || typeof record.password !== 'string') {
    return { ok: false, error: passwordError ?? 'Use a password of 8 to 72 characters.' }
  }
  const teamIds = cleanTeamIds(record.team_ids)
  if (!teamIds) return { ok: false, error: 'Choose at least one side.' }
  const note = cleanNote(record.note)
  if (!note.ok) return note
  return { ok: true, value: { email, fullName, password: record.password, teamIds, note: note.note } }
}

export function parseSignupChoice(value: unknown): { ok: true; value: SignupChoice } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'Choose at least one side.' }
  const record = value as Record<string, unknown>
  const teamIds = cleanTeamIds(record.team_ids)
  if (!teamIds) return { ok: false, error: 'Choose at least one side, then try again.' }
  const note = cleanNote(record.note)
  if (!note.ok) return { ok: false, error: note.error }
  const fullName = record.full_name == null || record.full_name === '' ? null : cleanPersonName(record.full_name)
  if (record.full_name != null && record.full_name !== '' && !fullName) {
    return { ok: false, error: 'Enter your full name.' }
  }
  return { ok: true, value: { teamIds, note: note.note, fullName } }
}

export function shouldNotifyApprover(input: {
  role: string
  active: boolean
  teamIds: readonly string[]
  requestedTeamIds: readonly string[]
}): boolean {
  if (!input.active) return false
  if (input.role === 'admin') return true
  if (input.role !== 'captain') return false
  return input.teamIds.some((teamId) => input.requestedTeamIds.includes(teamId))
}

export function approverIds(
  staff: readonly { id: string; role: string; active: boolean; teamIds: readonly string[] }[],
  requestedTeamIds: readonly string[],
): string[] {
  const ids: string[] = []
  for (const person of staff) {
    if (!shouldNotifyApprover({ ...person, requestedTeamIds })) continue
    if (!ids.includes(person.id)) ids.push(person.id)
  }
  return ids
}

export function defaultTeamId(requestedIds: readonly string[], assignableIds: readonly string[]): string {
  for (const id of requestedIds) {
    if (assignableIds.includes(id)) return id
  }
  return assignableIds[0] ?? ''
}

export function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function sideList(names: readonly string[]): string {
  const clean = names.map((name) => headerSafe(name)).filter((name) => name.length > 0)
  if (clean.length === 0) return 'a side'
  if (clean.length === 1) return clean[0] ?? 'a side'
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`
  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`
}

function mailShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;background:#F7F4EA;color:#202050;font-family:Georgia,'Times New Roman',serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4EA;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-top:4px solid #D0A050;border-radius:16px;">
            <tr>
              <td style="padding:28px 24px;">
                <p style="margin:0 0 8px;letter-spacing:0.14em;text-transform:uppercase;color:#D0A050;font-weight:700;font-size:12px;font-family:Arial,sans-serif;">Cheetahs Cricket Club</p>
                <h1 style="margin:0 0 12px;color:#202050;font-size:28px;line-height:1.1;">${escapeHtml(title)}</h1>
                ${bodyHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export function approverMessage(input: {
  requesterName: string
  requesterEmail: string
  teamNames: readonly string[]
  note: string | null
  reviewUrl: string
  fromName: string
}): ClubMessage {
  const name = headerSafe(input.requesterName) || 'A new player'
  const email = headerSafe(input.requesterEmail)
  const sides = sideList(input.teamNames)
  const note = input.note ? headerSafe(input.note) : ''
  const reviewUrl = headerSafe(input.reviewUrl)
  const fromName = headerSafe(input.fromName) || 'Cheetahs Cricket Club'
  const subject = 'New Cheetahs access request'
  const noteLine = note ? `Note: ${note}` : 'They did not leave a note.'
  const text = [
    'Hello,',
    '',
    `${name} (${email}) asked to join ${sides}.`,
    noteLine,
    '',
    'Review the request:',
    reviewUrl,
    '',
    'You can approve it onto a side, or reject it. Nothing is shared with them until you decide.',
    '',
    fromName,
  ].join('\n')
  const html = mailShell(
    'New access request',
    `<p style="margin:0 0 12px;font-size:16px;line-height:1.5;"><strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) asked to join ${escapeHtml(sides)}.</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.5;">${escapeHtml(noteLine)}</p>
                <p style="margin:0 0 18px;"><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#D0A050;color:#202050;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:999px;font-family:Arial,sans-serif;">Review the request</a></p>
                <p style="margin:0;font-size:14px;line-height:1.5;">You can approve it onto a side, or reject it. Nothing is shared with them until you decide.</p>
                <p style="margin:18px 0 0;font-size:14px;color:#202050;">${escapeHtml(fromName)}</p>`,
  )
  return { subject, text, html }
}

export function decisionMessage(input: {
  decision: 'approved' | 'rejected'
  requesterName: string
  teamName: string | null
  roleName: string | null
  signInUrl: string
  fromName: string
}): ClubMessage {
  const fromName = headerSafe(input.fromName) || 'Cheetahs Cricket Club'
  const signInUrl = headerSafe(input.signInUrl)
  const name = headerSafe(input.requesterName)
  const hello = name ? `Hello ${name},` : 'Hello,'
  if (input.decision === 'rejected') {
    const subject = 'Cheetahs access request'
    const text = [
      hello,
      '',
      'A captain reviewed your request to join Cheetahs Cricket Club and is not able to approve it.',
      'If this was a surprise, reply to this email and a captain can take another look.',
      '',
      fromName,
    ].join('\n')
    const html = mailShell(
      'Request not approved',
      `<p style="margin:0 0 12px;font-size:16px;line-height:1.5;">${escapeHtml(hello)}</p>
                <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">A captain reviewed your request to join Cheetahs Cricket Club and is not able to approve it.</p>
                <p style="margin:0;font-size:16px;line-height:1.5;">If this was a surprise, reply to this email and a captain can take another look.</p>
                <p style="margin:18px 0 0;font-size:14px;color:#202050;">${escapeHtml(fromName)}</p>`,
    )
    return { subject, text, html }
  }

  const teamName = headerSafe(input.teamName ?? '') || 'the club'
  const roleName = headerSafe(input.roleName ?? '') || 'player'
  const subject = "You're in at Cheetahs Cricket Club"
  const text = [
    hello,
    '',
    `Your request was approved. You are a ${roleName} with ${teamName}.`,
    'Sign in to open the clubhouse:',
    signInUrl,
    '',
    fromName,
  ].join('\n')
  const html = mailShell(
    "You're in",
    `<p style="margin:0 0 12px;font-size:16px;line-height:1.5;">${escapeHtml(hello)}</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.5;">Your request was approved. You are a ${escapeHtml(roleName)} with ${escapeHtml(teamName)}.</p>
                <p style="margin:0 0 18px;"><a href="${escapeHtml(signInUrl)}" style="display:inline-block;background:#D0A050;color:#202050;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:999px;font-family:Arial,sans-serif;">Sign in</a></p>
                <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">Or copy this link:<br /><a href="${escapeHtml(signInUrl)}" style="color:#202050;">${escapeHtml(signInUrl)}</a></p>
                <p style="margin:18px 0 0;font-size:14px;color:#202050;">${escapeHtml(fromName)}</p>`,
  )
  return { subject, text, html }
}
