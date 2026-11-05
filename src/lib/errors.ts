export function actionError(message: string): string {
  const lower = message.toLowerCase()
  if (
    lower.includes('jwt') ||
    lower.includes('not authenticated') ||
    lower.includes('permission denied') ||
    lower.includes('row-level security') ||
    lower.includes('staff role')
  ) {
    return 'Captains and admins can change that.'
  }
  if (lower.includes('poll is closed')) return 'That poll is closed.'
  if (lower.includes('poll_votes') && lower.includes('duplicate')) {
    return 'You already voted. Change your choice instead.'
  }
  if (lower.includes('not your vote') || lower.includes('option does not belong')) {
    return 'That vote could not be saved.'
  }
  return message
}
