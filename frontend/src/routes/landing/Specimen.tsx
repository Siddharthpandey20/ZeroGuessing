import { useEffect, useState } from 'react'
import { ArrowUp, RotateCcw } from 'lucide-react'
import { CitationChip, type ChipSource } from '../../components/CitationChip'
import { Decode } from '../../components/Decode'
import { FaithMeter, type SegmentTone } from '../../components/FaithMeter'
import { SRC } from './specimens'
import styles from './Specimen.module.css'

type Verdict = 'supported' | 'contradicted' | 'conflicted'
interface Claim { text: string; verdict: Verdict; source: ChipSource; reason?: string }
interface Scene { q: string; claims: Claim[]; done: string }

const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** Real questions against the demo corpus (backend/corpus/FACTS.md); every claim is backed by its quote in specimens.ts. */
const SCENES: Scene[] = [
  {
    q: 'What is the prepayment penalty on a floating-rate home loan today?',
    claims: [
      { text: 'Floating-rate home loans taken by individual borrowers carry no prepayment penalty.', verdict: 'supported', source: SRC.c3 },
      { text: 'This applies from 1 July 2026 and replaces the 1% rate set by Circular 2025/14.', verdict: 'supported', source: SRC.b2 },
      { text: 'The penalty is 2% of the outstanding principal.', verdict: 'contradicted', source: SRC.a72, reason: 'Blocked: clause 7.2 of the Master Policy is superseded on this date.' },
    ],
    done: `Checked, rule in force on ${today}`,
  },
  {
    q: 'What are the penal charges on an overdue home-loan instalment?',
    claims: [
      { text: 'The Master Policy sets them at 2% p.a. over the contracted rate.', verdict: 'conflicted', source: SRC.a81, reason: 'The documents disagree: both quotes are shown.' },
      { text: 'The Key Facts Statement sets them at 24% p.a. on the overdue amount.', verdict: 'conflicted', source: SRC.d22 },
      { text: 'Charges run on the overdue amount for the days it remains unpaid.', verdict: 'supported', source: SRC.a81 },
    ],
    done: 'Checked, 1 conflict between documents',
  },
  {
    q: 'Are co-borrowers covered by the home loan protection insurance?',
    claims: [
      { text: 'The Policy Wording covers co-borrowers named in the loan agreement.', verdict: 'conflicted', source: SRC.f32, reason: 'The documents disagree: both quotes are shown.' },
      { text: 'The Policy Schedule insures the primary borrower only.', verdict: 'conflicted', source: SRC.g11 },
      { text: 'Where covered, co-borrowers are insured for their share of the outstanding loan.', verdict: 'supported', source: SRC.f32 },
    ],
    done: 'Checked, 1 conflict between documents',
  },
]

// timeline of one scene, in ms (the feel of the real chat: type, send, retrieve, stream, verify, hold)
const TYPE_AT = 350, CHAR = 32, SEND_PAUSE = 320, RETRIEVE = 900, WORD = 55, CLAIM_GAP = 160, VERIFY_GAP = 300, VERIFY = 600, HOLD = 3000, FADE = 450
const TICK = 50

function timeline(s: Scene) {
  const typeEnd = TYPE_AT + s.q.length * CHAR
  const sendAt = typeEnd + SEND_PAUSE
  const streamAt = sendAt + RETRIEVE
  const starts: number[] = []
  let t = streamAt
  for (const c of s.claims) {
    starts.push(t)
    t += c.text.split(' ').length * WORD + CLAIM_GAP
  }
  const verifyAt = t + VERIFY_GAP
  const doneAt = verifyAt + s.claims.length * VERIFY
  return { typeEnd, sendAt, streamAt, starts, verifyAt, doneAt, end: doneAt + HOLD }
}
const TIMELINES = SCENES.map(timeline)

/** Everything on the card at time `e` of scene `i`: a pure function of the clock, so the monitor copy stays in step. */
function frame(i: number, e: number) {
  const s = SCENES[i], tl = TIMELINES[i]
  const sent = e >= tl.sendAt
  const typed = sent ? '' : s.q.slice(0, Math.max(0, Math.floor((e - TYPE_AT) / CHAR)))
  const claims = s.claims.map((c, k) => {
    const words = c.text.split(' ')
    const started = e >= tl.starts[k]
    const n = Math.max(0, Math.min(words.length, Math.floor((e - tl.starts[k]) / WORD) + 1))
    const checked = e >= tl.verifyAt + (k + 1) * VERIFY
    return {
      ...c,
      shown: started ? words.slice(0, n).join(' ') : '',
      streaming: started && n < words.length,
      checked,
      state: !started ? 'waiting' : checked ? c.verdict : 'checking',
    }
  })
  const verifying = claims.findIndex((c) => !c.checked)
  const readout =
    !sent ? '7 documents loaded'
    : e < tl.streamAt ? 'Retrieving from 7 documents'
    : e < tl.verifyAt ? `Drafting ${s.claims.length} claims with citations`
    : e < tl.doneAt ? `Verifying claim ${verifying + 1} of ${s.claims.length}`
    : s.done
  const backed = s.claims.filter((c) => c.verdict !== 'contradicted').length
  return {
    scene: s, sent, typed, claims, readout,
    pressing: e >= tl.typeEnd && !sent,
    done: e >= tl.doneAt,
    fading: e >= tl.end - FADE,
    pct: e >= tl.doneAt ? (backed / s.claims.length) * 100 : null,
  }
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// shared by every copy (the card and its miniature on the monitor), so pausing on hover keeps them in step
let hovering = false
const RESTART = 'zg-specimen-restart'

/**
 * The hero's signature: a miniature of the real chat replaying questions from the demo corpus, on a loop.
 * A question is typed and sent, the answer streams in with its citations, each claim is checked, then the next one.
 */
export function Specimen({ start = true }: { start?: boolean }) {
  const [clock, setClock] = useState({ i: 0, e: 0 })

  // "start again" resets every copy at once
  useEffect(() => {
    const onRestart = () => setClock({ i: 0, e: reduced() ? TIMELINES[0].doneAt : 0 })
    window.addEventListener(RESTART, onRestart)
    return () => window.removeEventListener(RESTART, onRestart)
  }, [])

  useEffect(() => {
    if (reduced()) {
      setClock({ i: 0, e: TIMELINES[0].doneAt })
      return
    }
    setClock({ i: 0, e: 0 })
    if (!start) return // held until the hero plays, so the card and its copy on the monitor run in step
    let last = performance.now()
    const id = window.setInterval(() => {
      const now = performance.now()
      const dt = Math.min(now - last, TICK * 2) // a throttled background tab resumes where it was, no jump
      last = now
      if (document.hidden || hovering) return // paused while the pointer is on the answer, so a citation can be read
      setClock(({ i, e }) => (e + dt >= TIMELINES[i].end ? { i: (i + 1) % SCENES.length, e: 0 } : { i, e: e + dt }))
    }, TICK)
    return () => window.clearInterval(id)
  }, [start])

  const f = frame(clock.i, clock.e)
  const restart = () => window.dispatchEvent(new Event(RESTART))

  return (
    <figure className={styles.sheet} aria-label="Example answers from the demo corpus">
      <div className={styles.head}>
        {/* every question laid in the same cell, so the card keeps the height of the longest */}
        <div className={styles.stack}>
          {SCENES.map((s) => <p key={s.q} className={`${styles.q} ${styles.ghost}`} aria-hidden="true">{s.q}</p>)}
          <p className={styles.q} data-fading={f.fading || undefined}>{f.sent ? f.scene.q : ''}</p>
        </div>
        <button className="btn btn-quiet btn-icon btn-sm" type="button" onClick={restart} aria-label="Start the examples again">
          <RotateCcw size={15} strokeWidth={1.8} />
        </button>
      </div>

      <div className={styles.readout} data-done={f.done || undefined} aria-live="polite">
        <span className={styles.pulse} aria-hidden="true" />
        <Decode text={f.readout} className="readout" />
      </div>

      <div className={styles.stack} onPointerEnter={() => (hovering = true)} onPointerLeave={() => (hovering = false)}>
        {SCENES.map((s) => (
          <ol key={s.q} className={`${styles.claims} ${styles.ghost}`} aria-hidden="true" inert>
            {s.claims.map((c, k) => (
              <li key={k} className={styles.claim}>
                {c.text} <CitationChip source={c.source} />
                {c.reason && <span className={styles.reason}>{c.reason}</span>}
              </li>
            ))}
          </ol>
        ))}
        <ol className={styles.claims} data-fading={f.fading || undefined}>
          {f.claims.map((c, k) => (
            <li key={`${clock.i}-${k}`} className={styles.claim} data-state={c.state}>
              {c.state === 'waiting' ? (
                <span key="skel" className={styles.skel} aria-hidden="true" />
              ) : (
                <>
                  {/* own key: reusing the skeleton's span would animate its strike colour in, a visible flash */}
                  <span key="text" className={styles.claimText}>{c.shown}</span>
                  {c.streaming && <span className={styles.caret} aria-hidden="true" />}
                  {!c.streaming && (
                    <>
                      {' '}
                      <CitationChip source={c.source} tone={c.verdict === 'supported' ? 'proof' : c.verdict === 'conflicted' ? 'conflict' : 'blocked'} />
                    </>
                  )}
                  {c.reason && c.checked && <span className={styles.reason} data-tone={c.verdict}>{c.reason}</span>}
                </>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className={styles.foot}>
        <FaithMeter segments={f.claims.map((c) => (c.checked ? c.verdict : 'pending') as SegmentTone)} pct={f.pct} compact />
      </div>

      {/* the composer, as in the app: the next question is typed here and sent */}
      <div className={styles.composer} aria-hidden="true">
        <span className={styles.input}>
          {f.typed ? f.typed : <span className={styles.placeholder}>{f.sent ? 'Ask a follow-up…' : 'Ask about your documents…'}</span>}
          {!f.sent && <span className={styles.caret} />}
        </span>
        <span className={styles.send} data-on={f.typed ? true : undefined} data-press={f.pressing || undefined}>
          <ArrowUp size={14} strokeWidth={2.2} />
        </span>
      </div>
      <figcaption className={styles.caption}>Real questions against the demo corpus. Hover the answer to pause and see a citation's page.</figcaption>
    </figure>
  )
}
