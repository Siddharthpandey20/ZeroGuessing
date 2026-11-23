import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { HI } from './i18n.hi'

/**
 * Interface language. Strings are keyed by their English text, so a component reads the same in either language
 * and a missing translation falls back to English, never to a blank. `{name}` placeholders are filled from `vars`.
 * The answers themselves follow the question's language (a Hindi question gets a Hindi answer), not this setting.
 */
export type UiLang = 'en' | 'hi'
type Vars = Record<string, string | number>
export type T = (text: string, vars?: Vars) => string

const KEY = 'zg-ui-lang'

function read(): UiLang {
  try {
    return localStorage.getItem(KEY) === 'hi' ? 'hi' : 'en'
  } catch {
    return 'en'
  }
}

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s)

let current: UiLang = read()

/** The translator outside React state: fine because the app re-renders from the top when the language changes. */
export const tr: T = (text, vars) => translate(current, text, vars)

/** Locale for dates: Hindi month names with international numerals, as in official Hindi documents. */
export const uiLocale = () => (current === 'hi' ? 'hi-IN-u-nu-latn' : 'en-IN')

/** Devanagari digits are not used: Indian official Hindi documents keep international numerals, and so do the PDFs. */
export const translate = (lang: UiLang, text: string, vars?: Vars) => fill(lang === 'hi' ? HI[text] ?? text : text, vars)

interface LangState {
  lang: UiLang
  setLang: (l: UiLang) => void
  t: T
}

const Ctx = createContext<LangState>({ lang: 'en', setLang: () => {}, t: (s, v) => fill(s, v) })

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<UiLang>(read)
  useEffect(() => {
    document.documentElement.lang = lang === 'hi' ? 'hi' : 'en'
  }, [lang])
  const setLang = useCallback((l: UiLang) => {
    current = l
    setLangState(l)
    try {
      localStorage.setItem(KEY, l)
    } catch {
      /* private mode: the choice lasts for this visit */
    }
  }, [])
  const t = useCallback<T>((text, vars) => translate(lang, text, vars), [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  // keyed on the language: every string is re-read on a switch (queries and in-flight answers live outside, so survive)
  return <Ctx.Provider value={value}><Fragment key={lang}>{children}</Fragment></Ctx.Provider>
}

export const useLang = () => useContext(Ctx)
export const useT = () => useContext(Ctx).t

/** "1 document" / "3 documents" in English; Hindi nouns here don't change with the count. */
export function plural(t: T, n: number, one: string, many = `${one}s`) {
  return t(n === 1 ? `{n} ${one}` : `{n} ${many}`, { n })
}
