import { useEffect, useRef, useState } from 'react'
import { reducedMotion } from '../lib/motion'

/**
 * A pre-rendered 3D loop (rendered offline by render/render.py, the way wembi ships its 3D).
 * Poster paints instantly; the video loads only near the viewport, plays only while visible,
 * and reduced-motion users get the still poster.
 */
export function VideoLoop({ webm, mp4, poster, className, eager }: { webm: string; mp4: string; poster: string; className?: string; eager?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [load, setLoad] = useState(!!eager)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const v = ref.current
    if (!v || reducedMotion()) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setLoad(true)
          void v.play().catch(() => {})
        } else v.pause()
      },
      { rootMargin: '200px 0px' },
    )
    io.observe(v)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const v = ref.current
    if (load && v && !reducedMotion()) {
      v.load()
      void v.play().catch(() => {})
    }
  }, [load])

  return (
    <video
      ref={ref}
      className={className}
      data-ready={ready || undefined}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden="true"
      tabIndex={-1}
      onPlaying={() => setReady(true)}
    >
      {load && <source src={webm} type="video/webm" />}
      {load && <source src={mp4} type="video/mp4" />}
    </video>
  )
}
