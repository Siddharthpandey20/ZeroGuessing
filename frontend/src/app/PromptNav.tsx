import { useEffect, useRef, useState, type RefObject } from 'react'
import { tr } from '../lib/i18n'
import styles from './PromptNav.module.css'

export interface NavItem { key: string; question: string }

const OPEN_DELAY = 80, CLOSE_DELAY = 220
const MAX_TICKS = 14
const TOP_GAP = 24 // same offset the thread uses when it scrolls a new question into place

/**
 * ChatGPT-style jump list: a column of ticks on the right edge of the conversation, one per question, the one being
 * read drawn longer. Hover (or tap, or focus and Enter) opens the list of questions; picking one scrolls to it.
 * Each question's block in the thread carries data-turn={key}.
 */
export function PromptNav({ items, scroller }: { items: NavItem[]; scroller: RefObject<HTMLDivElement | null> }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const timer = useRef(0)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

  // which question is being read: the last one whose heading is above the upper third of the view
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let frame = 0
    const update = () => {
      frame = 0
      const line = el.scrollTop + el.clientHeight / 3
      let cur: string | null = null
      for (const a of el.querySelectorAll<HTMLElement>('article[data-turn]')) {
        if (a.offsetTop - TOP_GAP <= line) cur = a.dataset.turn ?? null
      }
      // scrolled to the very end: the last question is the one in view, even if it is short
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) cur = items[items.length - 1]?.key ?? cur
      setActive(cur)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [scroller, items])

  useEffect(() => () => clearTimeout(timer.current), [])

  if (items.length < 2) return null

  const later = (v: boolean, ms: number) => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(v), ms)
  }
  const jump = (key: string) => {
    const el = scroller.current
    const a = el?.querySelector<HTMLElement>(`article[data-turn="${CSS.escape(key)}"]`)
    if (!el || !a) return
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ top: a.offsetTop - TOP_GAP, behavior: smooth ? 'smooth' : 'auto' })
    setOpen(false)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
      btn.current?.focus()
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open) {
      e.preventDefault()
      const opts = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      const at = opts.indexOf(document.activeElement as HTMLButtonElement)
      const next = e.key === 'ArrowDown' ? Math.min(opts.length - 1, at + 1) : Math.max(0, at < 0 ? opts.length - 1 : at - 1)
      opts[next]?.focus()
    }
  }

  // many questions: a fixed number of ticks, each standing for a stretch of them
  const ticks = items.length <= MAX_TICKS ? items.map((_, i) => [i]) : Array.from({ length: MAX_TICKS }, (_, t) => {
    const a = Math.floor((t * items.length) / MAX_TICKS), b = Math.floor(((t + 1) * items.length) / MAX_TICKS)
    return Array.from({ length: b - a }, (_, k) => a + k)
  })
  const activeIdx = items.findIndex((it) => it.key === active)

  return (
    <div className={styles.nav} data-open={open || undefined} onMouseEnter={() => later(true, OPEN_DELAY)} onMouseLeave={() => later(false, CLOSE_DELAY)} onKeyDown={onKey}>
      <button ref={btn} type="button" className={styles.rail} aria-expanded={open} aria-controls="prompt-nav-list"
        aria-label={tr('Questions in this chat: {n}', { n: items.length })} onClick={() => setOpen((o) => !o)}>
        {ticks.map((idx, t) => <span key={t} className={styles.tick} data-on={idx.includes(activeIdx) || undefined} />)}
      </button>
      <div ref={list} id="prompt-nav-list" className={styles.panel} role="menu" aria-label={tr('Jump to a question')} hidden={!open}>
        <p className={styles.title}>{tr('Questions in this chat: {n}', { n: items.length })}</p>
        <ol className={styles.list}>
          {items.map((it, i) => (
            <li key={it.key}>
              <button type="button" role="menuitem" className={styles.item} data-on={it.key === active || undefined} onClick={() => jump(it.key)} title={it.question}>
                <span className={`${styles.n} tnum`}>{i + 1}</span>
                <span className={styles.q}>{it.question}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
