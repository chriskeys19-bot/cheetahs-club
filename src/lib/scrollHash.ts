export function scrollToLocationHash() {
  const id = decodeURIComponent(window.location.hash.replace(/^#/, ''))
  if (!id) return
  document.getElementById(id)?.scrollIntoView({ block: 'center' })
}
