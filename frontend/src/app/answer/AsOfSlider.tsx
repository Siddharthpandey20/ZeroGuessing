import { useId, useMemo, useState } from 'react'
import { useT } from '../../lib/i18n'
import type { Chain, ChainEvent } from '../../lib/types'
import { fmtDate, shortDoc } from './selection'
import styles from './AsOfSlider.module.css'

const DAY = 86_400_000
const toDay = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY)
const toIso = (d: number) => new Date(d * DAY).toISOString().slice(0, 10)

/** The version of a rule in force on `day`: the last change effective on or before it, else the original text. */
export function versionOn(events: ChainEvent[], day: number): number {
  let idx = 0
  events.forEach((e, i) => {
    if (i > 0 && e.effective_date && toDay(e.effective_date) <= day) idx = i
  })
  return idx
}

/**
 * Drag a date along a rule's history and read the version that applied on that day. It shows how an amendment
 * chain is resolved: the answer for "today" is the version under the marker at today. All on the client, from the
 * chain the answer already carries; nothing is guessed for dates the documents don't cover.
 */
export function AsOfSlider({ chain, asOf, onVersion, value }: {
  chain: Chain; asOf: string; onVersion: (index: number) => void; value: (e: ChainEvent) => string | null
}) {
  const t = useT()
  const id = useId()
  const stops = useMemo(() => chain.events.map((e, i) => (i > 0 && e.effective_date ? toDay(e.effective_date) : null)), [chain])
  const dated = stops.filter((d): d is number => d !== null)
  const today = toDay(new Date().toISOString())
  const asked = toDay(asOf)
  const lo = Math.min(...dated, asked) - 120
  const hi = Math.max(...dated, asked, today) + 90
  const [day, setDay] = useState(asked)
  const idx = versionOn(chain.events, day)
  const ev = chain.events[idx]
  const pos = (d: number) => `${((d - lo) / (hi - lo)) * 100}%`

  const move = (d: number) => {
    setDay(d)
    onVersion(versionOn(chain.events, d))
  }

  if (!dated.length) return null
  return (
    <section className={styles.wrap} aria-labelledby={`${id}-h`}>
      <div className={styles.top}>
        <p id={`${id}-h`} className={styles.kicker}>{t('Rule in force on')}</p>
        <p className={`${styles.date} tnum`}>{fmtDate(toIso(day))}</p>
      </div>

      <div className={styles.track}>
        <div className={styles.rail} aria-hidden="true">
          {stops.map((d, i) => d !== null && (
            <span key={i} className={styles.stop} style={{ left: pos(d) }} data-on={i === idx || undefined} title={fmtDate(toIso(d))} />
          ))}
          <span className={styles.today} style={{ left: pos(today) }}><span>{t('today')}</span></span>
        </div>
        <input id={id} type="range" className={styles.range} min={lo} max={hi} step={1} value={day}
          onChange={(e) => move(Number(e.target.value))}
          aria-valuetext={`${fmtDate(toIso(day))}: ${shortDoc(ev.doc_title ?? '')}`} aria-describedby={`${id}-v`} />
      </div>

      <div className={styles.jumps}>
        {chain.events.map((e, i) => {
          const d = i === 0 ? lo + 1 : stops[i]
          if (d === null) return null
          return (
            <button key={i} type="button" className={styles.jump} data-on={i === idx || undefined} onClick={() => move(d)}>
              {value(e) ?? (i === 0 ? t('Original') : t('Change {n}', { n: i }))}
            </button>
          )
        })}
        <button type="button" className={styles.jump} data-kind="today" onClick={() => move(today)}>{t('Today')}</button>
      </div>

      <div id={`${id}-v`} className={styles.result} aria-live="polite">
        <p className={styles.resultHead}>
          <span className={styles.value}>{value(ev) ?? '—'}</span>
          <span className={styles.from}>{shortDoc(ev.doc_title ?? '')}{ev.clause_ref ? `, ${ev.clause_ref}` : ''}</span>
        </p>
        <p className={styles.resultNote}>
          {idx === 0
            ? t('The original text applies: no change had taken effect yet.')
            : t('In force since {date}.', { date: fmtDate(ev.effective_date ?? '') })}
          {day > today && idx > 0 && ev.state === 'not_yet_effective' ? ` ${t('Announced, not yet in force today.')}` : ''}
        </p>
      </div>
    </section>
  )
}
