import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { DURATION_OPTIONS } from '../domain/challenge'
import type { NewChallengeInput } from '../app/use-savings-app'
import { useI18n } from '../i18n/LanguageProvider'
import { defaultForm, durationLabel, parseAmount, planFor, validateForm, type ChallengeForm, type FormField } from './create-challenge-form'

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
 * Validation messages are recalculated on every render, so they follow the language switch.
 */
export function CreateChallengeForm({ today, existingCount, submitLabel, onSubmit, onCancel }: CreateChallengeFormProps) {
  const i18n = useI18n()
  const { t, fmt } = i18n
  const [form, setForm] = useState<ChallengeForm>(() => defaultForm(existingCount, i18n))
  const [submitting, setSubmitting] = useState(false)
  const formId = useId()
  const validation = validateForm(form, today, i18n)
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
      await onSubmit({ name: validation.value.name || t.form.defaultName(existingCount + 1), config: validation.value.config })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="challenge-form" onSubmit={(event) => void submit(event)} noValidate>
      <Field id={`${formId}-name`} label={t.form.nameLabel} error={errors.name}>
        <input id={`${formId}-name`} value={form.name} maxLength={80} onChange={(event) => update('name', event.target.value)} />
      </Field>
      <Field id={`${formId}-target`} label={t.form.targetLabel} error={errors.target}>
        <input
          id={`${formId}-target`}
          inputMode="numeric"
          autoComplete="off"
          value={form.target}
          onChange={(event) => update('target', event.target.value)}
        />
      </Field>

      <fieldset className="duration-picker">
        <legend>{t.form.legend}</legend>
        <div className="duration-grid" role="radiogroup" aria-label={t.form.legend}>
          {DURATION_OPTIONS.map((duration) => (
            <button
              key={duration}
              type="button"
              role="radio"
              aria-checked={form.duration === duration}
              className={`duration-option${form.duration === duration ? ' selected' : ''}`}
              onClick={() => update('duration', duration)}
            >
              {durationLabel(duration, i18n)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field-pair">
        <Field id={`${formId}-min`} label={t.form.minLabel} error={errors.minDaily}>
          <input
            id={`${formId}-min`}
            inputMode="numeric"
            autoComplete="off"
            value={form.minDaily}
            onChange={(event) => update('minDaily', event.target.value)}
          />
        </Field>
        <Field id={`${formId}-max`} label={t.form.maxLabel} error={errors.maxDaily}>
          <input
            id={`${formId}-max`}
            inputMode="numeric"
            autoComplete="off"
            value={form.maxDaily}
            onChange={(event) => update('maxDaily', event.target.value)}
          />
        </Field>
      </div>

      <dl className="plan-summary" aria-label={t.form.summaryLabel} aria-live="polite">
        <div>
          <dt>{t.form.startDate}</dt>
          <dd>
            {fmt.date(plan.startDate)} {t.form.today}
          </dd>
        </div>
        <div>
          <dt>{t.form.endDate}</dt>
          <dd>{fmt.date(plan.endDate)}</dd>
        </div>
        <div>
          <dt>{t.form.savingDays}</dt>
          <dd>{t.units.days(plan.dayCount)}</dd>
        </div>
        <div>
          <dt>{t.form.target}</dt>
          <dd>{target === null ? '–' : fmt.sek(target)}</dd>
        </div>
        <div>
          <dt>{t.form.dailyAmounts}</dt>
          <dd>{minimum === null || maximum === null ? '–' : `${fmt.sek(minimum)} – ${fmt.sek(maximum)}`}</dd>
        </div>
      </dl>
      {validation.ok && (
        <p className="form-preview">
          {t.form.preview(
            fmt.sek(validation.value.averagePerDay),
            fmt.sek(validation.value.config.initialMinimumSek),
            fmt.sek(validation.value.config.preferredMaximumSek),
            fmt.sek(validation.value.config.targetSek),
          )}
        </p>
      )}
      <p className="form-note">{t.form.note}</p>

      <button type="submit" className="draw-button" disabled={submitting || !validation.ok}>
        {submitLabel}
      </button>
      {onCancel && (
        <button type="button" className="link-button centered" onClick={onCancel}>
          {t.form.cancel}
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
