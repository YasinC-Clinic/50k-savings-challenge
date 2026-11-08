import type { NewChallengeInput } from '../app/use-savings-app'
import { useI18n } from '../i18n/LanguageProvider'
import { CreateChallengeForm } from './CreateChallengeForm'

interface OnboardingProps {
  today: string
  onCreate: (input: NewChallengeInput) => Promise<unknown>
}

/** Shown when the device has no challenge yet. */
export function Onboarding({ today, onCreate }: OnboardingProps) {
  const { t } = useI18n()
  return (
    <section className="challenge-intro">
      <p className="eyebrow">
        <span className="status-dot" /> {t.onboarding.eyebrow}
      </p>
      <h1>
        {t.onboarding.titleBefore}
        <span>{t.onboarding.titleHighlight}</span>
      </h1>
      <p className="challenge-dates">{t.onboarding.intro}</p>
      <article className="settings-card">
        <h3>{t.onboarding.cardTitle}</h3>
        <CreateChallengeForm today={today} existingCount={0} submitLabel={t.onboarding.submit} onSubmit={onCreate} />
      </article>
      <p className="form-note">{t.onboarding.importHint}</p>
    </section>
  )
}
