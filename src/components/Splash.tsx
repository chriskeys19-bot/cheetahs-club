import { Crest } from './Crest.tsx'

export function Splash({ label }: { label: string }) {
  return (
    <div className="splash" role="status">
      <Crest width={112} alt="" />
      <p>{label}</p>
    </div>
  )
}
