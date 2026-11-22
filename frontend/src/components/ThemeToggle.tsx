import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

type Theme = 'light' | 'dark'
const read = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

/** santalarch's "invert colour": flips the whole system between day and night, remembered per browser. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(read)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('zg-theme', theme)
    } catch {
      /* private mode */
    }
  }, [theme])
  const next = theme === 'dark' ? 'light' : 'dark'
  const flip = () => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void }
    if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(() => setTheme(next))
    else setTheme(next)
  }
  return (
    <button type="button" className={`btn btn-quiet btn-icon btn-sm ${className ?? ''}`} onClick={flip} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {theme === 'dark' ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
    </button>
  )
}
