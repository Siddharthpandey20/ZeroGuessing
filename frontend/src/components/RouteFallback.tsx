export function RouteFallback() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }} aria-busy="true" aria-live="polite">
      <span className="readout muted" style={{ fontSize: 'var(--text-sm)' }}>Loading</span>
    </div>
  )
}
