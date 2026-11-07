import { Crest } from '../components/Crest.tsx'

export function SetupNotice() {
  return (
    <div className="splash">
      <Crest width={112} alt="Cheetahs Cricket Club crest" />
      <div className="setup-copy">
        <h1>Clubhouse needs its keys</h1>
        <p>
          Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to{' '}
          <code>.env.local</code>, then start the app again. Use the anon key only.
        </p>
      </div>
    </div>
  )
}
