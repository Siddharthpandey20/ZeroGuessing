import { useLang } from '../lib/i18n'
import styles from './LangSwitch.module.css'

/** English / हिन्दी interface switch. Answers already follow the language of the question. */
export function LangSwitch() {
  const { lang, setLang, t } = useLang()
  return (
    <div className={styles.switch} role="group" aria-label={t('Interface language')}>
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} lang="en">EN</button>
      <button type="button" aria-pressed={lang === 'hi'} onClick={() => setLang('hi')} lang="hi">हिं</button>
    </div>
  )
}
