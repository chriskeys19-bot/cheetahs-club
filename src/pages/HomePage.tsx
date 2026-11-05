import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { FeedbackComposer } from '../components/FeedbackComposer.tsx'
import { FeedbackList } from '../components/FeedbackList.tsx'
import { loadFeedback } from '../lib/feedback.ts'
import { supabase } from '../lib/supabase.ts'
import { displayName, roleLabel, type FeedbackRow, type Team } from '../lib/types.ts'

function parseTeams(value: unknown): Team[] {
  if (!Array.isArray(value)) return []
  const teams: Team[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.slug !== 'string') {
      continue
    }
    teams.push({ id: row.id, name: row.name, slug: row.slug })
  }
  return teams
}

export function HomePage() {
  const { session, profile, profileError } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [teamError, setTeamError] = useState<string | null>(null)
  const [rows, setRows] = useState<FeedbackRow[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [listToken, setListToken] = useState(0)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    supabase
      .from('teams')
      .select('id, name, slug')
      .order('slug')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setTeamError(error.message)
          setTeams([])
        } else {
          setTeamError(null)
          setTeams(parseTeams(data))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadFeedback(3).then(({ rows: next, error }) => {
      if (cancelled) return
      setRows(next)
      setListError(error)
    })
    return () => {
      cancelled = true
    }
  }, [listToken])

  const name = displayName(profile, session?.user.email)
  const roleLine = profile
    ? `You are signed in as ${roleLabel(profile.role).toLowerCase()}.`
    : profileError
      ? 'Your club role could not be loaded. You can still send a suggestion.'
      : 'Checking your club role…'

  return (
    <div className="page">
      <header className="page-intro">
        <p className="kicker">Clubhouse</p>
        <h1>Welcome, {name}</h1>
        <p className="lede">{roleLine}</p>
      </header>
      <div className="home-grid">
        <FeedbackComposer onSubmitted={() => setListToken((value) => value + 1)} />
        <section className="panel" aria-labelledby="sides-heading">
          <div className="section-heading">
            <p className="kicker">Squads</p>
            <h2 id="sides-heading">The sides</h2>
          </div>
          {teamError ? (
            <p className="banner banner-error" role="alert">
              {teamError}
            </p>
          ) : null}
          <ul className="team-grid">
            {teams.map((team) => (
              <li key={team.id} className="team-card">
                <p className="team-slug">{team.slug}</p>
                <p className="team-name">{team.name}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="panel recent" aria-labelledby="recent-heading">
        <div className="section-heading">
          <p className="kicker">Yours</p>
          <h2 id="recent-heading">Latest suggestions</h2>
        </div>
        {listError ? (
          <p className="banner banner-error" role="alert">
            {listError}
          </p>
        ) : (
          <FeedbackList rows={rows} empty="Nothing in the box yet." showSubmitter={false} />
        )}
        <p className="fine-print">
          <Link to="/feedback">Open the full suggestion box</Link>
        </p>
      </section>
    </div>
  )
}
