import { useEffect, useRef, useState } from 'react'
import { Camera, SwitchCamera, X } from 'lucide-react'
import styles from './CameraCapture.module.css'

/** Live viewfinder: point the camera at a printed question or clause and take the shot. */
export function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cams, setCams] = useState(0)

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal() // no close() in a cleanup: see ShareDialog
  }, [])

  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    setReady(false)
    setError(null)
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(async (s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        const v = video.current
        if (!v) return
        v.srcObject = s
        await v.play().catch(() => {})
        setReady(true)
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
        setCams(devices.filter((d) => d.kind === 'videoinput').length)
      })
      .catch((e: DOMException) => {
        if (cancelled) return
        setError(
          e.name === 'NotAllowedError' ? 'Camera access is blocked. Allow it in the browser’s site settings, or upload an image instead.'
          : e.name === 'NotFoundError' ? 'No camera was found on this device. Upload an image instead.'
          : 'The camera could not be started. Upload an image instead.',
        )
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [facing])

  const shoot = () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')?.drawImage(v, 0, 0)
    c.toBlob((b) => b && onCapture(new File([b], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', 0.92)
  }

  return (
    <dialog ref={dialog} className={styles.dialog} onClose={onClose} aria-labelledby="cam-title">
      <div className={styles.head}>
        <h2 id="cam-title" className={styles.title}>Take a photo</h2>
        <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={onClose} aria-label="Close the camera"><X size={16} /></button>
      </div>
      <div className={styles.view}>
        <video ref={video} className={styles.video} data-mirror={facing === 'user' || undefined} playsInline muted aria-label="Camera preview" />
        {!ready && !error && <span className={styles.wait}>Starting the camera</span>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
      <p className={styles.hint}>Point at the printed question or clause and hold steady. The text is read, and you check it before asking.</p>
      <div className={styles.actions}>
        {cams > 1 && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}>
            <SwitchCamera size={15} aria-hidden="true" /> Switch camera
          </button>
        )}
        <span className={styles.spacer} />
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={shoot} disabled={!ready}>
          <Camera size={15} aria-hidden="true" /> Capture
        </button>
      </div>
    </dialog>
  )
}
