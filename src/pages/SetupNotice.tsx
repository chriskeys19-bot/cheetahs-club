export function SetupNotice() {
  return (
    <div className="splash">
      <img src="/crest.jpg" alt="Cheetahs Cricket Club crest" width={112} height={112} />
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
