import { Link } from 'react-router'

export default function NotFound() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeContent: 'center', gap: 'var(--space-lg)', padding: 'var(--space-lg)', justifyItems: 'start' }}>
      <p className="readout muted">404</p>
      <h1 style={{ fontSize: 'var(--text-section)', fontWeight: 560, letterSpacing: '-0.04em', lineHeight: 1 }}>No page here. Nothing guessed.</h1>
      <Link to="/" className="btn btn-ink">Back to the start</Link>
    </main>
  )
}
