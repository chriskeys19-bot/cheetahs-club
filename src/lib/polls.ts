import { actionError } from './errors.ts'
import { supabase } from './supabase.ts'
import type { Poll, PollOption, PollStatus, PollTally } from './types.ts'

function isStatus(value: unknown): value is PollStatus {
  return value === 'open' || value === 'closed'
}

function parsePolls(value: unknown): Poll[] {
  if (!Array.isArray(value)) return []
  const rows: Poll[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (
      typeof row.id !== 'string' ||
      typeof row.question !== 'string' ||
      typeof row.created_at !== 'string' ||
      !isStatus(row.status)
    ) {
      continue
    }
    rows.push({
      id: row.id,
      question: row.question,
      description: typeof row.description === 'string' ? row.description : null,
      created_by: typeof row.created_by === 'string' ? row.created_by : null,
      created_at: row.created_at,
      closes_at: typeof row.closes_at === 'string' ? row.closes_at : null,
      status: row.status,
    })
  }
  return rows
}

function parseOptions(value: unknown): PollOption[] {
  if (!Array.isArray(value)) return []
  const rows: PollOption[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (
      typeof row.id !== 'string' ||
      typeof row.poll_id !== 'string' ||
      typeof row.label !== 'string' ||
      typeof row.sort_order !== 'number'
    ) {
      continue
    }
    rows.push({ id: row.id, poll_id: row.poll_id, label: row.label, sort_order: row.sort_order })
  }
  return rows
}

function parseVotes(value: unknown): Map<string, string> {
  const votes = new Map<string, string>()
  if (!Array.isArray(value)) return votes
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.poll_id === 'string' && typeof row.option_id === 'string') {
      votes.set(row.poll_id, row.option_id)
    }
  }
  return votes
}

function parseTallies(value: unknown): PollTally[] {
  if (!Array.isArray(value)) return []
  const rows: PollTally[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.poll_id !== 'string' || typeof row.option_id !== 'string') continue
    const votes = typeof row.votes === 'number' ? row.votes : Number(row.votes)
    if (!Number.isFinite(votes)) continue
    rows.push({ poll_id: row.poll_id, option_id: row.option_id, votes })
  }
  return rows
}

export type PollBoard = {
  polls: Poll[]
  options: PollOption[]
  votes: Map<string, string>
  tallies: PollTally[]
}

export async function loadPollBoard(userId: string): Promise<{ board: PollBoard; error: string | null }> {
  if (!supabase) {
    return {
      board: { polls: [], options: [], votes: new Map(), tallies: [] },
      error: 'Supabase is not configured.',
    }
  }
  const [polls, options, votes, tallies] = await Promise.all([
    supabase
      .from('polls')
      .select('id, question, description, created_by, created_at, closes_at, status')
      .order('created_at', { ascending: false }),
    supabase.from('poll_options').select('id, poll_id, label, sort_order').order('sort_order'),
    supabase.from('poll_votes').select('poll_id, option_id').eq('voter_id', userId),
    supabase.rpc('poll_tallies'),
  ])
  const error = polls.error ?? options.error ?? votes.error ?? tallies.error
  if (error) {
    return {
      board: { polls: [], options: [], votes: new Map(), tallies: [] },
      error: error.message,
    }
  }
  return {
    board: {
      polls: parsePolls(polls.data),
      options: parseOptions(options.data),
      votes: parseVotes(votes.data),
      tallies: parseTallies(tallies.data),
    },
    error: null,
  }
}

export function pollIsOpen(poll: Poll, now = Date.now()): boolean {
  if (poll.status !== 'open') return false
  if (!poll.closes_at) return true
  const closes = new Date(poll.closes_at).getTime()
  return Number.isNaN(closes) || closes > now
}

export async function createPoll(input: {
  question: string
  description: string | null
  closes_at: string | null
  options: string[]
}): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { data, error } = await supabase
    .from('polls')
    .insert({
      question: input.question.trim(),
      description: input.description,
      closes_at: input.closes_at,
      status: 'open',
    })
    .select('id')
    .single()
  if (error) return actionError(error.message)
  const id = data && typeof data === 'object' && typeof data.id === 'string' ? data.id : null
  if (!id) return 'The poll was saved without an id.'
  const { error: optionError } = await supabase.from('poll_options').insert(
    input.options.map((label, index) => ({
      poll_id: id,
      label: label.trim(),
      sort_order: index,
    })),
  )
  if (optionError) {
    await supabase.from('polls').delete().eq('id', id)
    return actionError(optionError.message)
  }
  return null
}

export async function castVote(input: {
  pollId: string
  optionId: string
  voterId: string
  existing: boolean
}): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { error } = input.existing
    ? await supabase
        .from('poll_votes')
        .update({ option_id: input.optionId })
        .eq('poll_id', input.pollId)
        .eq('voter_id', input.voterId)
    : await supabase.from('poll_votes').insert({
        poll_id: input.pollId,
        option_id: input.optionId,
        voter_id: input.voterId,
      })
  return error ? actionError(error.message) : null
}

export async function setPollStatus(id: string, status: PollStatus): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { error } = await supabase.from('polls').update({ status }).eq('id', id)
  return error ? actionError(error.message) : null
}

export async function removePoll(id: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { error } = await supabase.from('polls').delete().eq('id', id)
  return error ? actionError(error.message) : null
}

export async function updatePoll(input: {
  id: string
  question: string
  description: string | null
  closes_at: string | null
  options: Array<{ id: string | null; label: string }>
  votedOptionIds: string[]
}): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { data, error: loadError } = await supabase
    .from('poll_options')
    .select('id, poll_id, label, sort_order')
    .eq('poll_id', input.id)
  if (loadError) return actionError(loadError.message)
  const existing = parseOptions(data)
  const keptIds = new Set(
    input.options.map((option) => option.id).filter((id): id is string => typeof id === 'string' && id.length > 0),
  )
  for (const id of keptIds) {
    if (!existing.some((option) => option.id === id)) return 'A choice on this poll could not be found.'
  }
  const removed = existing.filter((option) => !keptIds.has(option.id))
  const voted = new Set(input.votedOptionIds)
  if (removed.some((option) => voted.has(option.id))) {
    return 'A choice that already has votes stays on the poll. Rename it instead of removing it.'
  }

  const { error: pollError } = await supabase
    .from('polls')
    .update({
      question: input.question.trim(),
      description: input.description,
      closes_at: input.closes_at,
    })
    .eq('id', input.id)
  if (pollError) return actionError(pollError.message)

  for (const option of input.options) {
    if (!option.id) continue
    const { error } = await supabase.from('poll_options').update({ label: `~${option.id}` }).eq('id', option.id)
    if (error) return actionError(error.message)
  }
  for (const [index, option] of input.options.entries()) {
    if (!option.id) continue
    const { error } = await supabase
      .from('poll_options')
      .update({ label: option.label.trim(), sort_order: index })
      .eq('id', option.id)
    if (error) return actionError(error.message)
  }

  const fresh = input.options
    .map((option, index) => ({ option, index }))
    .filter((item) => !item.option.id)
  if (fresh.length > 0) {
    const { error } = await supabase.from('poll_options').insert(
      fresh.map(({ option, index }) => ({
        poll_id: input.id,
        label: option.label.trim(),
        sort_order: index,
      })),
    )
    if (error) return actionError(error.message)
  }

  for (const option of removed) {
    const { error } = await supabase.from('poll_options').delete().eq('id', option.id)
    if (error) return actionError(error.message)
  }
  return null
}
