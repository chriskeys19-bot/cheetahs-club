const INSTAGRAM_URL = 'https://www.instagram.com/cheetahs_cricket_club/'

export function InstagramLink() {
  return (
    <a
      className="instagram-link"
      href={INSTAGRAM_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Cheetahs Cricket Club on Instagram"
    >
      <InstagramIcon />
      <span className="instagram-handle">@cheetahs_cricket_club</span>
    </a>
  )
}

function InstagramIcon() {
  return (
    <svg className="instagram-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.2" cy="6.8" r="1.15" fill="currentColor" />
    </svg>
  )
}
