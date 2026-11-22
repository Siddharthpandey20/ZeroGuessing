import { useState } from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  size,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  useTransitionStyles,
} from '@floating-ui/react'
import styles from './CitationChip.module.css'

export interface ChipSource {
  docTitle: string
  clause?: string | null
  page?: number | null
  quote: string
  img: string
  status?: string | null
  statusNote?: string | null
}

interface Props {
  source: ChipSource
  tone?: 'proof' | 'conflict' | 'blocked' | 'plain'
  active?: boolean
  onSelect?: () => void
}

export function chipLabel(s: Pick<ChipSource, 'docTitle' | 'clause' | 'page'>) {
  const t = s.docTitle.trim()
  const parts = [t.length > 30 ? t.slice(0, 29).trimEnd() + '…' : t]
  if (s.clause) parts.push(s.clause)
  if (s.page) parts.push(`p.${s.page}`)
  return parts.join(', ')
}

/** A citation that shows its source on hover or focus: the highlighted crop of the page, then the verbatim quote. */
export function CitationChip({ source, tone = 'proof', active, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(10),
      flip({ padding: 12, fallbackPlacements: ['bottom-start', 'top-end', 'bottom-end'] }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableWidth, elements }) {
          elements.floating.style.maxWidth = `${Math.min(520, availableWidth)}px`
        },
      }),
    ],
  })
  const hover = useHover(context, { delay: { open: 70, close: 120 }, handleClose: safePolygon({ buffer: 2 }) })
  const focus = useFocus(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role])
  // enter/exit with transform + opacity only; reduced motion gets an instant swap
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: reduce ? 0 : { open: 220, close: 120 },
    initial: { opacity: 0, transform: 'translateY(6px) scale(0.985)' },
    open: { opacity: 1, transform: 'none', transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    close: { opacity: 0, transform: 'translateY(4px)' },
  })

  const label = chipLabel(source)
  const stale = source.status && source.status !== 'current'

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        className={styles.chip}
        data-tone={tone}
        data-active={active || undefined}
        aria-label={`Source: ${source.docTitle}${source.clause ? `, clause ${source.clause}` : ''}${source.page ? `, page ${source.page}` : ''}`}
        {...getReferenceProps({ onClick: onSelect })}
      >
        <span className={styles.glyph} aria-hidden="true" />
        <span className={styles.text}>{label}</span>
      </button>
      <FloatingPortal>
        {isMounted && (
            <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 600 }} {...getFloatingProps()}>
              <div className={styles.pop} style={transitionStyles}>
                <div className={styles.popHead}>
                  <span className={styles.popDoc}>{source.docTitle}</span>
                  <span className="readout muted">
                    {source.clause ? `${source.clause}  ` : ''}
                    {source.page ? `p.${source.page}` : ''}
                  </span>
                </div>
                <img className={`crop ${styles.popImg}`} src={source.img} alt="" loading="eager" decoding="async" />
                <p className={styles.quote}>“{source.quote.trim()}”</p>
                {stale && <p className={styles.stale}>{source.statusNote || `This clause is ${source.status?.replaceAll('_', ' ')} on the date asked.`}</p>}
                {onSelect && <p className={styles.hint}>Click to open the full page</p>}
              </div>
            </div>
        )}
      </FloatingPortal>
    </>
  )
}
