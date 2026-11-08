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
import { formatDate, sek } from './format'

export const dayStatusLabel: Record<DayStatus, string> = {
  undrawn: 'Ej dragen',
  drawn: 'Dragen',
  confirmed: 'Bekräftad',
  missed: 'Missad',
}

export const challengeStatusLabel: Record<DashboardView['status'], string> = {
  upcoming: 'Kommande',
  active: 'Pågår',
  finished: 'Avslutad',
}

/** Null for challenges the user created themselves: no badge is needed. */
export function originLabel(origin: ChallengeOrigin): string | null {
  switch (origin) {
    case 'legacy-v1-migration':
      return 'Från tidigare version'
    case 'legacy-v1-backup':
      return 'Importerad (äldre säkerhetskopia)'
    case 'backup-import':
      return 'Importerad säkerhetskopia'
    case 'backup-restore':
      return 'Återställd från säkerhetskopia'
    default:
      return null
  }
}

/** Name shown for a challenge; migrated and unnamed challenges fall back to their target. */
export function challengeTitle(name: string | null, config: ChallengeConfig): string {
  return name ?? `Utmaning ${sek(config.targetSek)}`
}

export interface Notice {
  tone: 'info' | 'warning' | 'danger'
  title: string
  body: string
}

export function planNotice(plan: PlanStatus, config: ChallengeConfig): Notice | null {
  switch (plan.kind) {
    case 'raised-ceiling':
      return {
        tone: 'warning',
        title: 'Högre dagsbelopp krävs',
        body: `För att nå målet i tid behöver några kommande dagar bli upp till ${sek(plan.ceilingSek)} – mer än ditt högsta dagsbelopp på ${sek(plan.preferredMaximumSek)}. Det valda taket har inte ändrats; beloppet är det som krävs för att nå målet innan slutdatumet.`,
      }
    case 'unreachable':
      return {
        tone: 'danger',
        title: 'Målet kan inte nås i tid',
        body: `Med de dagar som är kvar går det inte att nå ${sek(config.targetSek)} till ${formatDate(config.endDate)}. ${sek(plan.unplannedSek)} saknas i planen, med dagsbelopp mellan ${sek(config.initialMinimumSek)} och ${sek(config.preferredMaximumSek)}. Slutdatumet och dagsbeloppen ändras inte automatiskt.`,
      }
    case 'ended-short':
      return {
        tone: 'info',
        title: 'Utmaningen är avslutad',
        body: `Du sparade ${sek(config.targetSek - plan.shortfallSek)} av ${sek(config.targetSek)}. Historiken finns kvar.`,
      }
    case 'completed':
      return { tone: 'info', title: 'Målet är nått', body: `Du har sparat hela ${sek(config.targetSek)}. Bra jobbat!` }
    default:
      return null
  }
}

/** Shown once, right after the plan was recalculated because of missed days. */
export function recoveryNotice(recovery: Recovery, config: ChallengeConfig): Notice {
  if (recovery.status === 'impossible') {
    return {
      tone: 'danger',
      title: 'Målet kan inte längre nås',
      body: `Missade dagar gör att ${sek(config.targetSek)} inte går att nå till ${formatDate(config.endDate)} med dagsbelopp mellan ${sek(config.initialMinimumSek)} och ${sek(config.preferredMaximumSek)}. Slutdatumet flyttas inte automatiskt.`,
    }
  }
  if (recovery.status === 'needs_higher_ceiling') {
    return {
      tone: 'warning',
      title: 'Planen har räknats om',
      body: `För att nå målet krävs nu belopp upp till ${sek(recovery.ceiling)} per dag – mer än ditt högsta dagsbelopp på ${sek(config.preferredMaximumSek)}. Det valda taket har inte ändrats.`,
    }
  }
  return {
    tone: 'info',
    title: 'Planen har räknats om',
    body: `Missade dagar räknas inte som sparade. De kommande beloppen har fördelats om och ligger mellan ${sek(config.initialMinimumSek)} och ${sek(config.preferredMaximumSek)} per dag.`,
  }
}

const BACKUP_ERRORS: Array<[RegExp, string]> = [
  [/not valid JSON/, 'Filen går inte att läsa som en säkerhetskopia.'],
  [/format is not supported/, 'Filen är ingen säkerhetskopia från den här appen.'],
  [/version is not supported/, 'Filen kommer från en okänd eller nyare version av appen.'],
  [/too large/, 'Filen är för stor för att vara en säkerhetskopia.'],
  [/too many challenges/, 'Filen innehåller fler utmaningar än vad som stöds.'],
  [/duplicate/, 'Filen innehåller samma utmaning flera gånger.'],
  [/add up to the target|exceed the target/, 'Beloppen i filen stämmer inte med utmaningens mål.'],
  [/longer than|above the supported|not achievable|configuration/, 'Utmaningens inställningar i filen är ogiltiga.'],
  [/Replacing all challenges needs/, 'Du måste bekräfta att allt ska ersättas.'],
  [/legacy backup can only/, 'En äldre säkerhetskopia kan bara läggas till som ny utmaning.'],
]

/** Plain Swedish for any error the app can show. Never exposes database terms. */
export function errorMessage(error: unknown): string {
  if (error instanceof BackupValidationError) {
    const known = BACKUP_ERRORS.find(([pattern]) => pattern.test(error.message))
    return `${known?.[1] ?? 'Innehållet i filen är ogiltigt.'} Inget på enheten har ändrats.`
  }
  if (error instanceof LegacyDataDamagedError) return 'Sparad data från den tidigare versionen är skadad.'
  if (error instanceof PersistenceVersionError) return 'Datan på enheten kommer från en nyare version av appen. Ladda om appen.'
  if (error instanceof PersistenceIntegrityError) return 'Sparad data kunde inte verifieras. Inget har ändrats.'
  if (error instanceof PersistenceDatabaseError) return 'Det gick inte att spara på enheten. Inget har ändrats – försök igen.'
  if (error instanceof Error) return domainErrorMessage(error.message)
  return 'Något gick fel. Försök igen.'
}

function domainErrorMessage(message: string): string {
  if (/already exists/.test(message)) return 'Dagens belopp är redan draget.'
  if (/already confirmed/.test(message)) return 'Det här beloppet är redan bekräftat.'
  if (/Only a drawn amount/.test(message)) return 'Dra dagens belopp först.'
  if (/missed day cannot be drawn/.test(message)) return 'Den här dagen har missats och kan inte dras.'
  if (/outside the challenge|Only the current/.test(message)) return 'Det går bara att dra och bekräfta dagens belopp.'
  return 'Något gick fel. Försök igen.'
}
