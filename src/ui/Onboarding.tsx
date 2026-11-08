import type { NewChallengeInput } from '../app/use-savings-app'
import { CreateChallengeForm } from './CreateChallengeForm'

interface OnboardingProps {
  today: string
  onCreate: (input: NewChallengeInput) => Promise<unknown>
}

/** Shown when the device has no challenge yet. */
export function Onboarding({ today, onCreate }: OnboardingProps) {
  return (
    <section className="challenge-intro">
      <p className="eyebrow">
        <span className="status-dot" /> Välkommen
      </p>
      <h1>
        Spara <span>steg för steg</span>
      </h1>
      <p className="challenge-dates">
        Välj ett mål och en period. Varje dag drar du ett slumpmässigt belopp och bekräftar när du har sparat det.
      </p>
      <article className="settings-card">
        <h3>Skapa din första utmaning</h3>
        <CreateChallengeForm today={today} existingCount={0} submitLabel="Starta utmaningen" onSubmit={onCreate} />
      </article>
      <p className="form-note">Har du en säkerhetskopia från tidigare? Importera den under Inställningar.</p>
    </section>
  )
}
