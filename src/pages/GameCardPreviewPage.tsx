import { AuthContext, type AuthValue } from '../auth/auth-context.ts'
import { GameCard } from '../components/GameCard.tsx'
import { StreamsContext, type StreamsValue } from '../components/streams-context.ts'
import type { GameStream } from '../lib/streamStatus.ts'
import type { ScheduleEvent } from '../lib/types.ts'

const captain: AuthValue = {
  session: null,
  profile: { id: 'user-1', full_name: 'Captain', role: 'captain' },
  accountProfile: { id: 'user-1', full_name: 'Captain', role: 'captain' },
  authReady: true,
  profileReady: true,
  profileError: null,
  canSwitchRole: false,
  viewRole: null,
  setViewRole: () => undefined,
  passwordRecovery: false,
  acknowledgeRecovery: () => undefined,
  signIn: async () => null,
  signOut: async () => undefined,
  googleGateReady: true,
}

function event(patch: Partial<ScheduleEvent> & Pick<ScheduleEvent, 'id' | 'opponent' | 'result' | 'match_status'>): ScheduleEvent {
  return {
    team_id: 'team-beta',
    umpiring_team_id: null,
    game_date: '2026-11-01',
    start_time: '08:45',
    end_time: null,
    starts_at: '2026-11-01T16:45:00Z',
    ends_at: null,
    match_format: 'T20',
    ground: 'Anthony Ochoa Middle School',
    address: '2121 Depot Rd, Hayward, CA',
    event_type: 'league_game',
    division: null,
    notes: null,
    created_by: 'user-1',
    series_id: null,
    venue_side: 'away',
    ball_color: null,
    dress_code: null,
    scorecard_url: null,
    video_url: null,
    ...patch,
  }
}

const readyStream: GameStream = {
  id: 'stream-win',
  schedule_event_id: 'game-win',
  status: 'ready',
  stream_key_name: 'Yolobox Pro 2',
  youtube_video_id: 'abcdefghijk',
  youtube_url: 'https://youtube.com/watch?v=abcdefghijk',
  scorecard_url: 'https://cricclubs.com/Cheetahs/viewScorecard.do?matchId=42',
  overlay_url: 'https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=42&clubId=1712',
  overlay_short_url: 'https://is.gd/cheetahs42',
  whatsapp_message: null,
  last_error: null,
  requested_by: 'user-1',
  checked_at: null,
  created_at: '2026-11-01T16:00:00Z',
  updated_at: '2026-11-01T18:00:00Z',
}

const failedStream: GameStream = {
  ...readyStream,
  id: 'stream-failed',
  schedule_event_id: 'game-failed',
  status: 'failed',
  youtube_video_id: null,
  youtube_url: null,
  scorecard_url: null,
  overlay_url: null,
  overlay_short_url: null,
  last_error: 'CricketCrazeUSA did not respond.',
}

const board: StreamsValue = {
  ready: true,
  streams: [readyStream, failedStream],
  jobs: [],
  keys: [],
  error: null,
  reload: async () => undefined,
}

const cards: ScheduleEvent[] = [
  event({
    id: 'game-win',
    opponent: 'Cougars Black',
    result: 'win',
    match_status: 'completed',
    video_url: 'https://youtube.com/watch?v=cheetahs-win',
    scorecard_url: 'https://cricclubs.com/NCCA/viewScorecard.do?matchId=11',
    team_id: 'team-alpha',
    ground: 'Birch Grove',
  }),
  event({
    id: 'game-loss',
    opponent: 'Strikers Blue 2',
    result: 'loss',
    match_status: 'completed',
    video_url: 'https://youtube.com/watch?v=cheetahs-loss',
    game_date: '2026-11-07',
    starts_at: '2026-11-07T20:45:00Z',
  }),
  event({
    id: 'game-draw',
    opponent: 'Strong Arm',
    result: 'draw',
    match_status: 'completed',
    game_date: '2026-11-14',
    starts_at: '2026-11-14T20:45:00Z',
  }),
  event({
    id: 'game-open',
    opponent: 'Livermore Monks',
    result: null,
    match_status: 'completed',
    game_date: '2026-11-01',
  }),
  event({
    id: 'game-failed',
    opponent: 'Livermore Monks',
    result: null,
    match_status: 'scheduled',
    game_date: '2026-11-01',
    starts_at: '2026-11-01T16:45:00Z',
  }),
]

export function GameCardPreviewPage() {
  const asOf = Date.parse('2026-11-08T20:00:00Z')
  return (
    <AuthContext.Provider value={captain}>
      <StreamsContext.Provider value={board}>
        <div className="page">
          <header className="page-intro">
            <p className="kicker">Winter 2026-27</p>
            <h1>Schedules</h1>
          </header>
          <div className="filter-bar" role="group" aria-label="Schedule filter">
            <button type="button" className="filter-chip" aria-pressed="false">
              All · 24
            </button>
            <button type="button" className="filter-chip" aria-pressed="true">
              Upcoming · 18
            </button>
            <button type="button" className="filter-chip" aria-pressed="false">
              Completed · 6
            </button>
          </div>
          <section className="panel">
            <div className="section-heading">
              <p className="kicker">Events</p>
              <h2>Upcoming games</h2>
            </div>
            <ul className="card-list tiles">
              {cards.map((row) => (
                <GameCard
                  key={row.id}
                  event={row}
                  sideName={row.team_id === 'team-alpha' ? 'Cheetahs Alpha' : 'Cheetahs Beta'}
                  teamSlug={row.team_id === 'team-alpha' ? 'alpha' : 'beta'}
                  asOf={asOf}
                  canEdit
                  onVideoSaved={() => undefined}
                />
              ))}
            </ul>
          </section>
        </div>
      </StreamsContext.Provider>
    </AuthContext.Provider>
  )
}
