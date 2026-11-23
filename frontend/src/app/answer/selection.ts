import { uiLocale } from '../../lib/i18n'
import type { Chain, Citation, Conflict } from '../../lib/types'

/** What the evidence panel is showing. */
export type Selection =
  | { kind: 'citation'; citation: Citation; highlight: string[] }
  | { kind: 'conflict'; conflict: Conflict }
  | { kind: 'chain'; chain: Chain }
  | null

export type CropFor = (sentenceId: string) => string

export const STATUS_LABEL: Record<string, string> = {
  answered: 'Answered with proof',
  partial: 'Partly answered',
  conflicted: 'The documents conflict',
  abstained: 'No proof found',
  chat: 'Reply',
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(uiLocale(), opts)
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(uiLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Drop chains that are a tail of a longer chain (the resolver reports each link it walked). */
export function distinctChains(chains: Chain[]): Chain[] {
  const ids = (c: Chain) => c.events.map((e) => e.sentence_id ?? '').join('|')
  const sorted = [...chains].filter((c) => c.events.length > 1).sort((a, b) => b.events.length - a.events.length)
  const kept: Chain[] = []
  for (const c of sorted) if (!kept.some((k) => ids(k).endsWith(ids(c)))) kept.push(c)
  return kept
}

export const shortDoc = (t: string) => t.replace(/^Circular:\s*/i, 'Circular, ').replace(/\s+–\s+/g, ', ')

/** A title cut at a word boundary, for buttons. */
export function briefDoc(t: string, max = 26) {
  const s = t.replace(/^Circular:\s*/i, 'Circular on ').replace(/\s+[–-]\s+.*/, '')
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 12)).replace(/[,\s]+$/, '')}…`
}
