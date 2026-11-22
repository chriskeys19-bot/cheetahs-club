import { Link } from 'react-router'
import { Crest } from '../components/Crest.tsx'
import { PRIVACY_PARAGRAPHS, TERMS_PARAGRAPHS } from '../lib/legalCopy.ts'

function LegalLayout({ title, paragraphs }: { title: string; paragraphs: readonly string[] }) {
  return (
    <div className="legal-page">
      <Crest width={72} alt="" />
      <p className="kicker">Cheetahs Cricket Club</p>
      <h1>{title}</h1>
      {paragraphs.map((paragraph) => (
        <p key={paragraph}>{linkify(paragraph)}</p>
      ))}
      <nav className="legal-links">
        <Link to="/">Home</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
      </nav>
    </div>
  )
}

function linkify(paragraph: string) {
  const parts = paragraph.split(/(https:\/\/[^\s]+|cricketcrazeusa@gmail\.com)/g)
  return parts.map((part) => {
    if (part.startsWith('https://')) {
      const href = part.replace(/[.,]$/, '')
      return (
        <a key={part} href={href}>
          {href}
        </a>
      )
    }
    if (part === 'cricketcrazeusa@gmail.com') {
      return (
        <a key={part} href="mailto:cricketcrazeusa@gmail.com">
          {part}
        </a>
      )
    }
    return part
  })
}

export function PrivacyPage() {
  return <LegalLayout title="Privacy policy" paragraphs={PRIVACY_PARAGRAPHS} />
}

export function TermsPage() {
  return <LegalLayout title="Terms" paragraphs={TERMS_PARAGRAPHS} />
}
