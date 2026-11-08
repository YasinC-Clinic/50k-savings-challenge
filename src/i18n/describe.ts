import type { ChallengeConfig, DayStatus, Recovery } from '../domain/challenge'
import {
  BackupValidationError,
  LegacyDataDamagedError,
  PersistenceDatabaseError,
  PersistenceIntegrityError,
  PersistenceVersionError,
  type ChallengeOrigin,
} from '../persistence/savings-repository'
import type { DashboardView, PlanStatus } from '../app/savings-view'
import type { FeedbackMessage } from '../app/use-savings-app'
import type { I18n } from './i18n'

export interface Notice {
  tone: 'info' | 'warning' | 'danger'
  title: string
  body: string
}

export function dayStatusLabel(status: DayStatus, { t }: I18n): string {
  return t.status.day[status]
}

export function challengeStatusLabel(status: DashboardView['status'], { t }: I18n): string {
  return t.status.challenge[status]
}

/** Null for challenges the user created themselves: no badge is needed. */
export function originLabel(origin: ChallengeOrigin, { t }: I18n): string | null {
  return t.status.origin[origin]
}

/** The name given by the user, or a description built from the target (never stored). */
export function challengeTitle(name: string | null, config: ChallengeConfig, { t, fmt }: I18n): string {
  return name ?? t.status.unnamed(fmt.sek(config.targetSek))
}

/** The standing note about the plan (derived from stored data), or null when everything is on track. */
export function planNotice(plan: PlanStatus, config: ChallengeConfig, { t, fmt }: I18n): Notice | null {
  const minimum = fmt.sek(config.initialMinimumSek)
  const maximum = fmt.sek(config.preferredMaximumSek)
  switch (plan.kind) {
    case 'raised-ceiling':
      return {
        tone: 'warning',
        title: t.notices.raisedCeiling.title,
        body: t.notices.raisedCeiling.body(fmt.sek(plan.ceilingSek), fmt.sek(plan.preferredMaximumSek)),
      }
    case 'unreachable':
      return {
        tone: 'danger',
        title: t.notices.unreachable.title,
        body: t.notices.unreachable.body(fmt.sek(config.targetSek), fmt.date(config.endDate), fmt.sek(plan.unplannedSek), minimum, maximum),
      }
    case 'ended-short':
      return {
        tone: 'info',
        title: t.notices.endedShort.title,
        body: t.notices.endedShort.body(fmt.sek(config.targetSek - plan.shortfallSek), fmt.sek(config.targetSek)),
      }
    case 'completed':
      return { tone: 'info', title: t.notices.completed.title, body: t.notices.completed.body(fmt.sek(config.targetSek)) }
    default:
      return null
  }
}

/** Shown once, right after the plan was recalculated because of missed days. */
export function recoveryNotice(recovery: Recovery, config: ChallengeConfig, { t, fmt }: I18n): Notice {
  const minimum = fmt.sek(config.initialMinimumSek)
  const maximum = fmt.sek(config.preferredMaximumSek)
  if (recovery.status === 'impossible') {
    return {
      tone: 'danger',
      title: t.notices.recoveryImpossible.title,
      body: t.notices.recoveryImpossible.body(fmt.sek(config.targetSek), fmt.date(config.endDate), minimum, maximum),
    }
  }
  if (recovery.status === 'needs_higher_ceiling') {
    return {
      tone: 'warning',
      title: t.notices.recoveryHigherCeiling.title,
      body: t.notices.recoveryHigherCeiling.body(fmt.sek(recovery.ceiling), maximum),
    }
  }
  return { tone: 'info', title: t.notices.recoveryOk.title, body: t.notices.recoveryOk.body(minimum, maximum) }
}

/** The words for a feedback descriptor, in the language that is selected right now. */
export function feedbackText(message: FeedbackMessage, i18n: I18n): string {
  const { t } = i18n
  switch (message.kind) {
    case 'drawn':
      return t.feedback.drawn
    case 'confirmed':
      return t.feedback.confirmed
    case 'created':
      return t.feedback.created
    case 'restored':
      return t.feedback.restored
    case 'imported':
      return message.count === 1 ? t.feedback.importedOne : t.feedback.importedMany(message.count)
    case 'date-changed':
      return t.feedback.dateChanged
    case 'error':
      return errorMessage(message.error, i18n)
  }
}

/** Messages of the backup parser are matched by pattern; each pattern selects one translated text. */
type BackupErrorKey = keyof I18n['t']['errors']['backup']

const BACKUP_ERRORS: Array<[RegExp, BackupErrorKey]> = [
  [/not valid JSON/, 'notJson'],
  [/format is not supported/, 'wrongFormat'],
  [/version is not supported/, 'version'],
  [/too large/, 'tooLarge'],
  [/too many challenges/, 'tooMany'],
  [/duplicate/, 'duplicate'],
  [/add up to the target|exceed the target/, 'totals'],
  [/longer than|above the supported|not achievable|configuration/, 'config'],
  [/Replacing all challenges needs/, 'confirmReplace'],
  [/legacy backup can only/, 'legacyReplace'],
]

/** Plain language for any error the app can show. Never exposes database terms. */
export function errorMessage(error: unknown, { t }: I18n): string {
  if (error instanceof BackupValidationError) {
    const key = BACKUP_ERRORS.find(([pattern]) => pattern.test(error.message))?.[1] ?? 'unknown'
    return `${t.errors.backup[key]} ${t.errors.unchanged}`
  }
  if (error instanceof LegacyDataDamagedError) return t.errors.storage.legacyDamaged
  if (error instanceof PersistenceVersionError) return t.errors.storage.newerVersion
  if (error instanceof PersistenceIntegrityError) return t.errors.storage.integrity
  if (error instanceof PersistenceDatabaseError) return t.errors.storage.database
  if (error instanceof Error) return domainErrorMessage(error.message, t.errors.domain)
  return t.errors.domain.generic
}

function domainErrorMessage(message: string, domain: I18n['t']['errors']['domain']): string {
  if (/already exists/.test(message)) return domain.alreadyDrawn
  if (/already confirmed/.test(message)) return domain.alreadyConfirmed
  if (/Only a drawn amount/.test(message)) return domain.drawFirst
  if (/missed day cannot be drawn/.test(message)) return domain.missedDay
  if (/outside the challenge|Only the current/.test(message)) return domain.outsideChallenge
  return domain.generic
}
