import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { reducedMotion } from '../../lib/motion'
import { Specimen } from './Specimen'
import styles from './HeroScene.module.css'

// The monitor's screen inside the 800x600 drawing; the miniature chat is placed and clipped to exactly this box.
const SCREEN = { x: 214, y: 124, w: 372, h: 214 }
const VB = { w: 800, h: 600 }
const pct = (n: number, of: number) => `${(n / of) * 100}%`

const HOLD_MS = 2400 // the big scene holds this long after the intro
const SHRINK_MS = 1700 // keep in step with .scene's transform transition
const GROW_MS = 1150 // the chat card growing out of the screen
const EASE = 'cubic-bezier(0.65, 0, 0.25, 1)'
const DESK = 420 / VB.h // the desk's top edge in the drawing, as a share of its height
const WIDE_PX = 1152 // 72rem: below this the card drops under the headline (see Landing.module.css)
const CARD_ABOVE_DESK = 10, CARD_BELOW_MARK = 16, MIN_ZOOM = 0.62
const LINK_TUCK = 3 // the dotted lines end this far under the card's edge, so no sliver of gap shows while it tilts

interface Anchors {
  hero: RefObject<HTMLElement | null>
  copy: RefObject<HTMLElement | null>
  actions: RefObject<HTMLElement | null>
  spec: RefObject<HTMLElement | null>
  mark?: RefObject<HTMLElement | null> // the big wordmark: the opening scene stays below it
}

/** Where text actually ends (a block's own box is as wide as its column). */
function textRect(el: Element | null) {
  if (!el) return null
  const r = document.createRange()
  r.selectNodeContents(el)
  return r.getBoundingClientRect()
}

/**
 * Someone at a desk, seen from behind, with the answer card playing out on their monitor.
 * 1. Only this scene shows, large, under the wordmark, while the check runs on the screen.
 * 2. The whole scene (one unit) scales down and settles beside the headline, level with the buttons.
 * 3. The answer card then grows out of that small screen, from the screen's exact box to its own place.
 * Laid out at its final box; the opening size is a transform on top of it, so nothing reflows.
 */
export function HeroScene({ play, anchors, onRevealed }: { play: boolean; anchors: Anchors; onRevealed: () => void }) {
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null)
  const [from, setFrom] = useState<string | null>(null)
  const [cardW, setCardW] = useState(520)
  const [settled, setSettled] = useState(false)
  const settledRef = useRef(false)
  const revealed = useRef(false)
  const screenRef = useRef<HTMLDivElement>(null)
  const linksRef = useRef<SVGSVGElement>(null)
  const [linked, setLinked] = useState(false)

  const measure = useCallback(() => {
    const hero = anchors.hero.current, copy = anchors.copy.current, actions = anchors.actions.current, spec = anchors.spec.current
    if (!hero || !copy || !actions || !spec) return
    const H = hero.getBoundingClientRect()
    const textRight = Math.max(...[...copy.children].map((c) => textRect(c)?.right ?? 0))
    const act = textRect(actions)!
    const S = spec.getBoundingClientRect()
    const gap = S.left - textRight
    let width: number, left: number
    // beside the headline the scene stands on the copy's last line (the proof list), so its desk is low enough for
    // the card above it; on narrow screens it stands level with the buttons
    let floor = act.bottom
    if (window.innerWidth > 768 && gap >= 170) {
      floor = copy.getBoundingClientRect().bottom
      width = Math.min(gap - 48, 320)
      left = textRight + (gap - width) / 2 - H.left
    } else {
      const avail = H.right - 16 - act.right
      width = Math.max(96, Math.min(avail - 16, 170))
      left = avail >= 110 ? act.right + (avail - width) / 2 - H.left : H.width - width - 16
    }
    const height = width * (VB.h / VB.w)
    const top = floor - H.top - height
    setBox({ left, top, width })
    const markBottom = anchors.mark?.current?.getBoundingClientRect().bottom ?? H.top + H.height * 0.35

    // Card beside the headline: its bottom edge sits just above the desk in the drawing, and if it is too tall for the
    // space between the wordmark and the desk it is zoomed down (zoom reflows it, so the text stays crisp).
    const inner = spec.firstElementChild as HTMLElement | null
    const grid = spec.parentElement
    let z = 1
    if (inner && grid) {
      inner.style.zoom = ''
      spec.style.translate = ''
      if (window.innerWidth > WIDE_PX && gap >= 170) {
        const deskY = top + height * DESK - CARD_ABOVE_DESK
        const room = deskY - (markBottom - H.top + CARD_BELOW_MARK)
        z = Math.max(MIN_ZOOM, Math.min(1, room / inner.offsetHeight))
        if (z < 1) inner.style.zoom = String(z)
        // read where the card ends only now: at full size a tall card can stretch the grid, which moves its bottom
        const G = grid.getBoundingClientRect()
        const base = G.bottom - parseFloat(getComputedStyle(grid).paddingBottom) - H.top
        // `translate`, not a margin: a margin would grow the grid row and push the headline down. It is also separate
        // from `transform`, which the grow-out animation owns.
        spec.style.translate = `0 ${-Math.max(0, base - deskY)}px`
      } else {
        spec.style.translate = ''
      }
    }
    if (!revealed.current) setCardW(Math.round(spec.offsetWidth / z) || 520) // the miniature is laid out like the card

    // the opening: as large as the free space allows, never over text. While the answer card is still hidden that
    // space is right of the headline and below the wordmark (on phones: below the buttons, within the first screen).
    const wide = window.innerWidth > 768
    const free = wide
      ? { l: textRight + 32, r: H.right - 32, t: markBottom + 40, b: H.bottom - 28 } // +40: the "g" hangs below its box
      : { l: H.left + 12, r: H.right - 12, t: act.bottom + 20, b: Math.min(H.bottom, window.innerHeight) - 16 }
    const fitW = Math.min(free.r - free.l, ((free.b - free.t) * VB.w) / VB.h, 900)
    const wi = Math.max(width, fitW)
    const cx = (free.l + free.r) / 2 - H.left
    const cy = (free.t + free.b) / 2 - H.top
    setFrom(`translate(${cx - (left + width / 2)}px, ${cy - (top + height / 2)}px) scale(${wi / width})`)
  }, [anchors])

  useLayoutEffect(() => {
    measure()
    let t = 0
    const onResize = () => {
      clearTimeout(t)
      t = window.setTimeout(measure, 120)
    }
    window.addEventListener('resize', onResize)
    void document.fonts?.ready.then(measure) // headline width changes once the display face loads
    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(t)
    }
  }, [measure])

  /**
   * Two dotted lines from the small screen to the card it opened into: screen's right edge to the card's left edge
   * (card beside the scene), or screen's bottom edge to the card's top (card below it, on phones). Follows the card's
   * live box, including the part still cropped by the growing clip, so the lines stretch out of the screen with it.
   */
  const drawLinks = useCallback(() => {
    const svg = linksRef.current, hero = anchors.hero.current, spec = anchors.spec.current, screen = screenRef.current
    if (!svg || !hero || !spec || !screen) return
    const H = hero.getBoundingClientRect(), S = screen.getBoundingClientRect(), W = spec.getBoundingClientRect()
    // aim at the card itself (it tilts toward the pointer and may be zoomed), not at its wrapper's square box
    const fig = spec.querySelector('figure')
    const R = fig?.getBoundingClientRect() ?? W
    const scale = spec.offsetWidth ? W.width / spec.offsetWidth : 1 // the grow-out transform, while it plays
    const zoom = parseFloat((spec.firstElementChild as HTMLElement | null)?.style.zoom || '1') || 1
    // the card's corners are rounded: end the lines where its edge is straight, or a gap shows at the corner
    const rad = (fig ? parseFloat(getComputedStyle(fig).borderTopLeftRadius) || 0 : 0) * zoom * scale
    const crop = /inset\(\s*-?[\d.]+px\s+-?[\d.]+px\s+(-?[\d.]+)px/.exec(getComputedStyle(spec).clipPath)
    const bottom = Math.min(R.bottom, W.bottom - (crop ? Math.max(0, parseFloat(crop[1])) * scale : 0))
    const beside = R.left >= S.right - 2
    const pairs = beside
      ? [[S.right, S.top, R.left + LINK_TUCK, R.top + rad], [S.right, S.bottom, R.left + LINK_TUCK, Math.max(R.top + rad, bottom - rad)]]
      : [[S.left, S.bottom, R.left + rad, R.top + LINK_TUCK], [S.right, S.bottom, R.right - rad, R.top + LINK_TUCK]]
    svg.querySelectorAll('line').forEach((l, i) => {
      const [x1, y1, x2, y2] = pairs[i]
      l.setAttribute('x1', String(x1 - H.left)); l.setAttribute('y1', String(y1 - H.top))
      l.setAttribute('x2', String(x2 - H.left)); l.setAttribute('y2', String(y2 - H.top))
    })
    svg.querySelectorAll('circle').forEach((c, i) => {
      const [x1, y1] = pairs[i]
      c.setAttribute('cx', String(x1 - H.left)); c.setAttribute('cy', String(y1 - H.top))
    })
  }, [anchors])

  /** FLIP the card from the small screen's box to its own: same top crop, so it reads as the screen opening up. */
  const reveal = useCallback(() => {
    const spec = anchors.spec.current, screen = screenRef.current
    if (!spec || revealed.current) return
    revealed.current = true
    const clear = () => {
      spec.style.transition = spec.style.transform = spec.style.clipPath = spec.style.transformOrigin = ''
      spec.style.opacity = '1' // stays inline: the card is shown from here on, whatever the hero's own reveal says
      onRevealed()
      requestAnimationFrame(drawLinks)
    }
    if (!screen || reducedMotion()) {
      setLinked(true)
      return clear()
    }
    // track the card every frame while it grows, so the lines stretch with it
    const until = performance.now() + GROW_MS + 120
    const follow = () => {
      drawLinks()
      if (performance.now() < until) requestAnimationFrame(follow)
    }
    requestAnimationFrame(follow)
    setLinked(true)
    spec.style.transition = 'none'
    spec.style.transform = 'none'
    const C = spec.getBoundingClientRect()
    const S = screen.getBoundingClientRect()
    const s = S.width / C.width
    const cropBottom = Math.max(0, C.height - S.height / s)
    const r0 = 6 / s
    spec.style.transformOrigin = '0 0'
    spec.style.transform = `translate(${S.left - C.left}px, ${S.top - C.top}px) scale(${s})`
    spec.style.clipPath = `inset(0px 0px ${cropBottom}px 0px round ${r0}px)`
    spec.style.opacity = '1'
    void spec.offsetWidth // commit the start frame before animating
    spec.style.transition = `transform ${GROW_MS}ms ${EASE}, clip-path ${GROW_MS}ms ${EASE}`
    spec.style.transform = 'none'
    spec.style.clipPath = 'inset(-80px -80px -80px -80px round 0px)' // past the card, so its shadow is not cut
    window.setTimeout(clear, GROW_MS + 60)
  }, [anchors, onRevealed, drawLinks])

  // keep the lines on the card and screen when the layout changes
  useEffect(() => {
    if (!linked) return
    let t = 0
    const onResize = () => {
      clearTimeout(t)
      t = window.setTimeout(() => requestAnimationFrame(drawLinks), 200) // after the scene has re-measured
    }
    window.addEventListener('resize', onResize)
    void document.fonts?.ready.then(() => requestAnimationFrame(drawLinks))
    // the card tilts toward the pointer and replays its questions on a loop: the lines follow it every frame, but only
    // while the hero is on screen and the tab is visible
    let raf = 0, onScreen = true
    const hero = anchors.hero.current
    const io = hero ? new IntersectionObserver(([e]) => (onScreen = e.isIntersecting)) : null
    if (hero) io?.observe(hero)
    const follow = () => {
      if (onScreen && !document.hidden) drawLinks()
      raf = requestAnimationFrame(follow)
    }
    raf = requestAnimationFrame(follow)
    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(t)
      cancelAnimationFrame(raf)
      io?.disconnect()
    }
  }, [linked, drawLinks, anchors])

  useEffect(() => {
    if (!play || settledRef.current) return
    const done = () => {
      settledRef.current = true
      setSettled(true)
    }
    if (reducedMotion()) {
      done()
      reveal()
      return
    }
    const ids = [window.setTimeout(done, HOLD_MS), window.setTimeout(reveal, HOLD_MS + SHRINK_MS - 150)]
    return () => ids.forEach(clearTimeout)
  }, [play, reveal])

  const screenPx = box ? box.width * (SCREEN.w / VB.w) : 0
  const style: CSSProperties = box
    ? { left: box.left, top: box.top, width: box.width, transform: settled || !from ? 'none' : from }
    : { visibility: 'hidden' }

  return (
    <>
    <svg ref={linksRef} className={styles.links} data-on={linked || undefined} aria-hidden="true">
      <line /><line />
      <circle r="2.5" /><circle r="2.5" />
    </svg>
    <div className={styles.scene} style={style} data-play={play || undefined} data-settled={settled || undefined} aria-hidden="true">
      <div className={styles.frame}>
        <SceneBack />
        <div ref={screenRef} className={styles.screen} style={{ left: pct(SCREEN.x, VB.w), top: pct(SCREEN.y, VB.h), width: pct(SCREEN.w, VB.w), height: pct(SCREEN.h, VB.h) }}>
          {/* the same answer card, laid out at its real width and scaled into the screen */}
          <div className={styles.mini} style={{ width: cardW, transform: `scale(${screenPx / cardW})` }} inert>
            <Specimen start={play} />
          </div>
          <span className={styles.glare} />
        </div>
        <SceneFront />
      </div>
    </div>
    </>
  )
}

/** Behind the screen: floor shadow, desk, plant, mug, keyboard and the monitor body. */
function SceneBack() {
  return (
    <svg className={styles.layer} viewBox={`0 0 ${VB.w} ${VB.h}`} preserveAspectRatio="xMidYMid meet">
      <ellipse cx="400" cy="584" rx="330" ry="12" fill="var(--color-rule)" />
      {/* desk */}
      <rect x="92" y="444" width="12" height="136" rx="3" fill="var(--color-ink-2)" opacity="0.55" />
      <rect x="696" y="444" width="12" height="136" rx="3" fill="var(--color-ink-2)" opacity="0.55" />
      <rect x="60" y="436" width="680" height="12" rx="3" fill="var(--color-ink-2)" opacity="0.35" />
      <rect x="40" y="420" width="720" height="18" rx="5" fill="var(--color-paper-3)" />
      <rect x="40" y="420" width="720" height="3" rx="1.5" fill="var(--color-paper-2)" />
      {/* plant */}
      <path d="M128 386 C108 360 104 336 116 318 C130 340 132 362 128 386Z" fill="var(--color-accent-2)" />
      <path d="M132 386 C140 352 156 334 176 328 C170 352 156 372 132 386Z" fill="var(--color-accent-2)" opacity="0.8" />
      <path d="M126 388 C110 372 92 366 76 370 C88 384 106 390 126 388Z" fill="var(--color-accent-2)" opacity="0.65" />
      <rect x="106" y="384" width="46" height="36" rx="7" fill="var(--color-paper-2)" stroke="var(--color-rule-strong)" />
      {/* mug */}
      <path d="M672 400 h8 a8 8 0 0 1 0 16 h-8" fill="none" stroke="var(--color-accent)" strokeWidth="5" />
      <rect x="640" y="392" width="34" height="28" rx="6" fill="var(--color-accent)" />
      {/* keyboard */}
      <rect x="322" y="410" width="160" height="9" rx="3" fill="var(--color-paper-2)" stroke="var(--color-rule)" />
      {/* monitor: foot, neck, body, black glass around the screen */}
      <rect x="326" y="412" width="148" height="9" rx="4.5" fill="var(--color-paper-2)" stroke="var(--color-rule-strong)" />
      <path d="M372 376 h56 l14 38 h-84 z" fill="var(--color-paper-3)" stroke="var(--color-rule-strong)" />
      <rect x="198" y="108" width="404" height="272" rx="16" fill="var(--color-paper-2)" stroke="var(--color-rule-strong)" />
      <rect x="208" y="118" width="384" height="226" rx="8" fill="var(--color-ink)" />
      <circle cx="400" cy="362" r="4" fill="var(--color-rule-strong)" />
    </svg>
  )
}

/** In front of the screen: the person, seen from behind, and their chair. */
function SceneFront() {
  return (
    <svg className={styles.layer} viewBox={`0 0 ${VB.w} ${VB.h}`} preserveAspectRatio="xMidYMid meet">
      {/* arms reaching for the keyboard */}
      <path d="M318 396 C298 414 296 430 326 438" fill="none" stroke="var(--color-ink-2)" strokeWidth="26" strokeLinecap="round" />
      <path d="M474 396 C494 414 496 430 466 438" fill="none" stroke="var(--color-ink-2)" strokeWidth="26" strokeLinecap="round" />
      {/* hoodie */}
      <path d="M302 478 C300 408 324 366 396 358 C468 366 492 408 490 478 Z" fill="var(--color-ink-2)" />
      <path d="M346 366 C360 388 432 388 446 366 C430 356 362 356 346 366 Z" fill="var(--color-ink)" opacity="0.55" />
      <path d="M396 372 v70" stroke="var(--color-ink)" strokeOpacity="0.35" strokeWidth="2" />
      {/* neck, ears, hair */}
      <rect x="383" y="336" width="26" height="24" rx="8" fill="oklch(78% 0.045 60)" />
      <ellipse cx="359" cy="318" rx="6" ry="9" fill="oklch(76% 0.05 60)" />
      <ellipse cx="433" cy="318" rx="6" ry="9" fill="oklch(76% 0.05 60)" />
      <circle cx="396" cy="310" r="37" fill="var(--color-ink)" />
      <path d="M368 288 C380 274 412 272 426 286" fill="none" stroke="var(--color-accent)" strokeOpacity="0.35" strokeWidth="4" strokeLinecap="round" />
      {/* headphones */}
      <path d="M357 312 C357 262 435 262 435 312" fill="none" stroke="var(--color-paper-2)" strokeWidth="6" strokeLinecap="round" />
      <rect x="349" y="304" width="14" height="24" rx="6" fill="var(--color-paper-2)" />
      <rect x="429" y="304" width="14" height="24" rx="6" fill="var(--color-paper-2)" />
      {/* chair */}
      <rect x="318" y="430" width="156" height="112" rx="24" fill="var(--color-ink)" />
      <rect x="330" y="442" width="132" height="88" rx="18" fill="var(--color-ink-2)" opacity="0.35" />
      <rect x="298" y="536" width="196" height="14" rx="7" fill="var(--color-ink)" />
      <rect x="389" y="550" width="14" height="22" fill="var(--color-ink)" />
      <path d="M322 578 H470" stroke="var(--color-ink)" strokeWidth="8" strokeLinecap="round" />
      <circle cx="322" cy="584" r="6" fill="var(--color-ink)" />
      <circle cx="396" cy="586" r="6" fill="var(--color-ink)" />
      <circle cx="470" cy="584" r="6" fill="var(--color-ink)" />
    </svg>
  )
}
