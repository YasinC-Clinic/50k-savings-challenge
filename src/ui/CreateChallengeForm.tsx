import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { DURATION_MONTH_OPTIONS } from '../domain/challenge'
import type { NewChallengeInput } from '../app/use-savings-app'
import { defaultForm, durationLabel, parseTarget, planFor, validateForm, type ChallengeForm, type FormField } from './create-challenge-form'
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
 * The person picks a duration; start and end dates are calculated, never typed.
 */
export function CreateChallengeForm({ today, existingCount, submitLabel, onSubmit, onCancel }: CreateChallengeFormProps) {
  const [form, setForm] = useState<ChallengeForm>(() => defaultForm(existingCount))
  const [submitting, setSubmitting] = useState(false)
  const formId = useId()
  const validation = validateForm(form, today)
  const errors = validation.ok ? {} : validation.errors
  const plan = planFor(today, form.months)
  const target = parseTarget(form.target)

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
      <fieldset className="duration-picker">
        <legend>Hur länge vill du spara?</legend>
        <div className="duration-grid" role="radiogroup" aria-label="Hur länge vill du spara?">
          {DURATION_MONTH_OPTIONS.map((months) => (
            <button
              key={months}
              type="button"
              role="radio"
              aria-checked={form.months === months}
              className={`duration-option${form.months === months ? ' selected' : ''}`}
              onClick={() => update('months', months)}
            >
              {durationLabel(months)}
            </button>
          ))}
        </div>
      </fieldset>

      <Field id={`${formId}-target`} label="Sparmål (kr)" error={errors.target}>
        <input
          id={`${formId}-target`}
          inputMode="numeric"
          autoComplete="off"
          value={form.target}
          onChange={(event) => update('target', event.target.value)}
        />
      </Field>
      <Field id={`${formId}-name`} label="Namn (valfritt)" error={errors.name}>
        <input id={`${formId}-name`} value={form.name} maxLength={80} onChange={(event) => update('name', event.target.value)} />
      </Field>

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
      </dl>
      {validation.ok && (
        <p className="form-preview">
          Cirka {sek(validation.value.averagePerDay)} per dag i snitt. Dagsbeloppen slumpas mellan 50 och 500 kr.
        </p>
      )}
      <p className="form-note">Dina andra utmaningar påverkas inte. Slutdatumet flyttas aldrig automatiskt.</p>

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
