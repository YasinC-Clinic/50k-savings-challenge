import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { DURATION_OPTIONS } from '../domain/challenge'
import type { NewChallengeInput } from '../app/use-savings-app'
import { defaultForm, durationLabel, parseAmount, planFor, validateForm, type ChallengeForm, type FormField } from './create-challenge-form'
import { formatDate, plural, sek } from './format'

interface CreateChallengeFormProps {
  /** Today's date in Europe/Stockholm. This is always the start date of the new challenge. */
  today: string
  existingCount: number
  submitLabel: string
  onSubmit: (input: NewChallengeInput) => Promise<unknown>
  onCancel?: () => void
}

/**
 * Used both for the first challenge (welcome screen) and for additional ones.
 * The person picks a duration and the daily limits; start and end dates are calculated, never typed.
 */
export function CreateChallengeForm({ today, existingCount, submitLabel, onSubmit, onCancel }: CreateChallengeFormProps) {
  const [form, setForm] = useState<ChallengeForm>(() => defaultForm(existingCount))
  const [submitting, setSubmitting] = useState(false)
  const formId = useId()
  const validation = validateForm(form, today)
  const errors = validation.ok ? {} : validation.errors
  const plan = planFor(today, form.duration)
  const target = parseAmount(form.target)
  const minimum = parseAmount(form.minDaily)
  const maximum = parseAmount(form.maxDaily)

  const update = <Field extends FormField>(field: Field, value: ChallengeForm[Field]) => {
    setForm((previous) => ({ ...previous, [field]: value }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!validation.ok) return
    setSubmitting(true)
    try {
      await onSubmit({ name: validation.value.name || `Utmaning ${existingCount + 1}`, config: validation.value.config })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="challenge-form" onSubmit={(event) => void submit(event)} noValidate>
      <Field id={`${formId}-name`} label="Namn (valfritt)" error={errors.name}>
        <input id={`${formId}-name`} value={form.name} maxLength={80} onChange={(event) => update('name', event.target.value)} />
      </Field>
      <Field id={`${formId}-target`} label="Sparmål (kr)" error={errors.target}>
        <input
          id={`${formId}-target`}
          inputMode="numeric"
          autoComplete="off"
          value={form.target}
          onChange={(event) => update('target', event.target.value)}
        />
      </Field>

      <fieldset className="duration-picker">
        <legend>Hur länge vill du spara?</legend>
        <div className="duration-grid" role="radiogroup" aria-label="Hur länge vill du spara?">
          {DURATION_OPTIONS.map((duration) => (
            <button
              key={duration}
              type="button"
              role="radio"
              aria-checked={form.duration === duration}
              className={`duration-option${form.duration === duration ? ' selected' : ''}`}
              onClick={() => update('duration', duration)}
            >
              {durationLabel(duration)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field-pair">
        <Field id={`${formId}-min`} label="Lägsta dagsbelopp (kr)" error={errors.minDaily}>
          <input
            id={`${formId}-min`}
            inputMode="numeric"
            autoComplete="off"
            value={form.minDaily}
            onChange={(event) => update('minDaily', event.target.value)}
          />
        </Field>
        <Field id={`${formId}-max`} label="Högsta dagsbelopp (kr)" error={errors.maxDaily}>
          <input
            id={`${formId}-max`}
            inputMode="numeric"
            autoComplete="off"
            value={form.maxDaily}
            onChange={(event) => update('maxDaily', event.target.value)}
          />
        </Field>
      </div>

      <dl className="plan-summary" aria-label="Sammanfattning av utmaningen" aria-live="polite">
        <div>
          <dt>Startdatum</dt>
          <dd>{formatDate(plan.startDate)} (idag)</dd>
        </div>
        <div>
          <dt>Slutdatum</dt>
          <dd>{formatDate(plan.endDate)}</dd>
        </div>
        <div>
          <dt>Antal spardagar</dt>
          <dd>{plural(plan.dayCount, 'dag', 'dagar')}</dd>
        </div>
        <div>
          <dt>Sparmål</dt>
          <dd>{target === null ? '–' : sek(target)}</dd>
        </div>
        <div>
          <dt>Dagsbelopp</dt>
          <dd>{minimum === null || maximum === null ? '–' : `${sek(minimum)} – ${sek(maximum)}`}</dd>
        </div>
      </dl>
      {validation.ok && (
        <p className="form-preview">
          Cirka {sek(validation.value.averagePerDay)} per dag i snitt. Varje dag slumpas ett belopp mellan {sek(validation.value.config.initialMinimumSek)} och{' '}
          {sek(validation.value.config.preferredMaximumSek)}, och summan blir exakt {sek(validation.value.config.targetSek)}.
        </p>
      )}
      <p className="form-note">
        Appen är inte kopplad till någon bank och flyttar aldrig pengar. Du drar ett belopp, för själv över det via din bank och bekräftar sedan i appen.
        Dina andra utmaningar påverkas inte, och slutdatumet flyttas aldrig automatiskt.
      </p>

      <button type="submit" className="draw-button" disabled={submitting || !validation.ok}>
        {submitLabel}
      </button>
      {onCancel && (
        <button type="button" className="link-button centered" onClick={onCancel}>
          Avbryt
        </button>
      )}
    </form>
  )
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
