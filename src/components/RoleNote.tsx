export function RoleNote({
  ready,
  restricted,
  children,
}: {
  ready: boolean
  restricted: boolean
  children: string
}) {
  if (!ready) return <p className="empty-copy">Checking your role…</p>
  if (restricted) return <p className="fine-print">{children}</p>
  return null
}
