export function Splash({ label }: { label: string }) {
  return (
    <div className="splash" role="status">
      <img src="/crest.jpg" alt="" width={112} height={112} />
      <p>{label}</p>
    </div>
  )
}
