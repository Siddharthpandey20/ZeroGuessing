import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import Lenis from 'lenis'
import { ArrowUpRight } from 'lucide-react'
import { Cursor } from '../components/Cursor'
import { Intro } from '../components/Intro'
import { Reveal, SplitText } from '../components/Reveal'
import { ThemeToggle } from '../components/ThemeToggle'
import { VideoLoop } from '../components/VideoLoop'
import { Wordmark } from '../components/Wordmark'
import { useAuth } from '../lib/auth'
import { reducedMotion, useInView, useScrollProgress } from '../lib/motion'
import { ProofStory } from './landing/ProofStory'
import { ScrollWords } from './landing/ScrollWords'
import { SectionPill } from './landing/SectionPill'
import { Measured, Safeguards } from './landing/Trust'
import { Specimen } from './landing/Specimen'
import { HeroScene } from './landing/HeroScene'
import capWebm from '../assets/video/checks-capsules.webm'
import capMp4 from '../assets/video/checks-capsules.mp4'
import capPoster from '../assets/video/checks-capsules-poster.webp'
import styles from './Landing.module.css'

function useSmoothScroll() {
  useEffect(() => {
    if (reducedMotion()) return
    const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 0.95, anchors: { offset: -16 } })
    let raf = requestAnimationFrame(function tick(t) {
      lenis.raf(t)
      raf = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(raf)
      lenis.destroy()
    }
  }, [])
}

/** Specimen card tilts toward the pointer, a little (wembi's floating media). */
function useTilt<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || reducedMotion() || !window.matchMedia('(pointer: fine)').matches) return
    let raf = 0, rx = 0, ry = 0, tx = 0, ty = 0
    const move = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2
      ty = (e.clientY / window.innerHeight - 0.5) * 2
    }
    const tick = () => {
      rx += (ty - rx) * 0.06
      ry += (tx - ry) * 0.06
      el.style.transform = `perspective(1200px) rotateX(${(-rx * 3).toFixed(2)}deg) rotateY(${(ry * 4).toFixed(2)}deg) translate3d(${(ry * 6).toFixed(1)}px, ${(rx * 6).toFixed(1)}px, 0)`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move)
    }
  }, [])
  return ref
}

export default function Landing() {
  useSmoothScroll()
  const { user } = useAuth()
  const enter = user ? '/app' : '/sign-in'
  const [play, setPlay] = useState(false)
  const onIntroDone = useCallback(() => setPlay(true), [])
  const tilt = useTilt<HTMLDivElement>()
  const heroRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const specRef = useRef<HTMLDivElement>(null)
  const markRef = useRef<HTMLDivElement>(null)
  // the answer card waits, hidden, until it grows out of the monitor in the hero scene
  const [specHeld, setSpecHeld] = useState(true)
  const onSpecRevealed = useCallback(() => setSpecHeld(false), [])
  const sceneAnchors = useMemo(() => ({ hero: heroRef, copy: copyRef, actions: actionsRef, spec: specRef, mark: markRef }), [])

  return (
    <div className={styles.page}>
      <Intro onDone={onIntroDone} />
      <Cursor />
      <SectionPill />
      <a href="#main" className={styles.skip}>Skip to content</a>

      {/* ---------- hero: rendered glass video, full-width wordmark, headline, live specimen ---------- */}
      <header className={styles.heroWrap} data-section="Start">
        <div ref={heroRef} className={styles.hero} data-play={play || undefined}>
          <HeroScene play={play} anchors={sceneAnchors} onRevealed={onSpecRevealed} />
          <div className={styles.veil} aria-hidden="true" />
          <span className={`${styles.corner} ${styles.cTL}`} aria-hidden="true" />
          <span className={`${styles.corner} ${styles.cTR}`} aria-hidden="true" />
          <span className={`${styles.corner} ${styles.cBL}`} aria-hidden="true" />
          <span className={`${styles.corner} ${styles.cBR}`} aria-hidden="true" />

          <nav className={styles.nav} aria-label="Main">
            <span className={`${styles.coord} readout`}>Document AI, verified</span>
            <div className={styles.navLinks}>
              <a href="#why">Why</a>
              <a href="#proofs">Proofs</a>
              <a href="#checks">How it checks</a>
              <a href="#measured">Measured</a>
              <a href="#safeguards">Safeguards</a>
              {!user && <Link to="/sign-in">Sign in</Link>}
            </div>
            <div className={styles.navEnd}>
              <ThemeToggle />
              <Link to={enter} className="btn btn-ink btn-sm">{user ? 'Open the workspace' : 'Get started'}</Link>
            </div>
          </nav>

          <div ref={markRef} className={styles.mark}>
            <Wordmark play={play} />
          </div>

          <div className={styles.heroGrid}>
            <div ref={copyRef} className={styles.heroCopy}>
              <h1 className={styles.h1} data-play={play || undefined}>
                {'Every answer arrives with its proof.'.split(' ').map((w, i) => (
                  // the space sits between the word boxes: inside an inline-block it collapses ("Everyanswer")
                  <Fragment key={i}><span className={styles.h1Word}><span style={{ '--d': `${700 + i * 70}ms` } as CSSProperties}>{w}</span></span>{' '}</Fragment>
                ))}
              </h1>
              <p className={styles.lead}>Ask across your loan agreements and circulars. Unproven claims are struck out.</p>
              <div ref={actionsRef} className={styles.actions}>
                <Link to={enter} className="btn btn-primary">
                  Open the workspace <ArrowUpRight size={16} strokeWidth={2} aria-hidden="true" />
                </Link>
                <a href="#checks" className="btn btn-hud">How it checks</a>
              </div>
              {/* what the product promises, in its own verdict colours: the same marks the answers use */}
              <ul className={styles.proofs} aria-label="What every answer guarantees">
                <li data-k="proof">Every sentence cited to its page</li>
                <li data-k="conflict">Disagreements shown side by side</li>
                <li data-k="blocked">“No proof” instead of a guess</li>
                <li data-k="seal">Reports signed and verifiable</li>
              </ul>
            </div>
            <div ref={specRef} className={styles.heroSpecimen} data-held={specHeld || undefined}>
              <div ref={tilt} className={styles.tilt}>
                <Specimen start={play} />
              </div>
            </div>
          </div>
        </div>
      </header>

      <main id="main">
        <IndexBar left="N.001" mid="Why" right="N.001" />
        <div id="why" data-section="Why">
          <ScrollWords
            marks={['quote', 'proof']}
            text="Banks, insurers and regulators run on dense PDFs. A chatbot that guesses is a liability. ZeroGuess answers only with a quote, shows you the page, flags clauses that disagree, and says it has no proof when the documents are silent."
          />
        </div>

        <IndexBar left="N.002" mid="Proofs" right="N.002" />
        <ProofStory />

        <IndexBar left="N.003" mid="How it checks" right="N.003" />
        <ChecksBand />

        <IndexBar left="N.004" mid="Measured" right="N.004" />
        <Measured />

        <IndexBar left="N.005" mid="Safeguards" right="N.005" />
        <Safeguards />

        <section className={styles.close} data-section="Start" aria-labelledby="close-title">
          <SplitText as="h2" text="Ask your first question." className={styles.closeH} />
          <Reveal as="p" className={styles.closeBody} delay={200}>
            Seven demo documents are loaded: a master policy, two amending circulars, a key facts statement, a vendor contract and an insurance policy with its schedule.
          </Reveal>
          <Reveal delay={320}>
            <Link to={enter} className="btn btn-primary">
              Open the workspace <ArrowUpRight size={16} strokeWidth={2} aria-hidden="true" />
            </Link>
          </Reveal>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footMark}><Wordmark play /></div>
        <div className={styles.footRow}>
          <span>Built for HackaSol 2026. Demo documents are fictional.</span>
          <nav aria-label="Footer" className={styles.footLinks}>
            <a href="#why">Why</a>
            <a href="#proofs">Proofs</a>
            <a href="#checks">How it checks</a>
            <a href="#measured">Measured</a>
            <a href="#safeguards">Safeguards</a>
            <Link to={enter}>Workspace</Link>
          </nav>
          <ThemeToggle />
        </div>
      </footer>
    </div>
  )
}

/** wembi's section index: three labels on a hairline that draws across when it arrives. */
function IndexBar({ left, mid, right }: { left: string; mid: string; right: string }) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div ref={ref} className={styles.indexBar} data-in={inView || undefined} aria-hidden="true">
      <span className="readout">{left}</span>
      <span className={styles.indexMid}>{mid}</span>
      <span className="readout">{right}</span>
      <i className={styles.indexLine} />
    </div>
  )
}

/** The capsule video held on screen while two tilted labels slide in (wembi's "Digital Twin / Functioning"). */
function ChecksBand() {
  const [ref, p] = useScrollProgress<HTMLElement>()
  const a = Math.min(1, Math.max(0, (p - 0.05) / 0.35))
  const b = Math.min(1, Math.max(0, (p - 0.25) / 0.35))
  return (
    <section id="checks" data-section="How it checks" aria-labelledby="checks-title">
      <div ref={ref as React.RefObject<HTMLDivElement>} className={styles.band}>
        <div className={styles.bandSticky}>
          <div className={styles.bandPanel}>
            <VideoLoop className={styles.video} webm={capWebm} mp4={capMp4} poster={capPoster} />
            <div className={styles.pills}>
              <span className={styles.pillA} style={{ '--a': a } as CSSProperties}>Four checks</span>
              <span className={styles.pillB} style={{ '--b': b } as CSSProperties}>before a sentence is shown</span>
            </div>
            <p className={styles.bandCaption}>Sentences fall through the check. Proven ones turn lime; the rest are blocked.</p>
          </div>
        </div>
      </div>

      <div className={styles.checks}>
        <h2 id="checks-title" className="sr-only">Four checks before a sentence is shown</h2>
        <ol className={styles.checkList}>
          {[
            ['The citation exists', 'The cited sentence was in the evidence the model was given.'],
            ['Every number matches', '2%, ₹25,000 and 30 days are compared with the quote after normalising.'],
            ['The clause is in force', 'Superseded and not-yet-effective clauses are blocked for the date asked.'],
            ['The quote entails it', 'A strict second reading compares the claim with its quote.'],
          ].map(([h, b], i) => (
            <Reveal as="li" key={h} delay={i * 110}>
              <span className={`${styles.checkN} readout`}>{i + 1}</span>
              <h3>{h}</h3>
              <p>{b}</p>
            </Reveal>
          ))}
        </ol>
        <Reveal as="p" className={styles.formula} delay={200}>
          <span className="readout">Faithfulness</span> = claims backed by a quote ÷ claims drafted, counted before anything is blocked.
        </Reveal>
      </div>
    </section>
  )
}
