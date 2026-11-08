import { describe, expect, it } from 'vitest'
import { DEFAULT_CHALLENGE_CONFIG } from '../domain/challenge'
import {
  BackupValidationError,
  LegacyDataDamagedError,
  PersistenceDatabaseError,
  PersistenceIntegrityError,
  PersistenceVersionError,
  type ChallengeOrigin,
} from '../persistence/savings-repository'
import { challengeTitle, errorMessage, originLabel, planNotice, recoveryNotice } from './sv'

const norm = (value: string) => value.replace(/[  ]/g, ' ')
const TECHNICAL = /indexeddb|dexie|transaction|schema|primary key|database|table|json|validation/i

describe('errorMessage', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['not JSON', new BackupValidationError('Backup is not valid JSON'), /går inte att läsa som en säkerhetskopia/],
    ['wrong format', new BackupValidationError('Backup format is not supported'), /ingen säkerhetskopia från den här appen/],
    ['unknown version', new BackupValidationError('Backup version is not supported'), /okänd eller nyare version/],
    ['too large', new BackupValidationError('Backup is too large'), /för stor/],
    ['too many', new BackupValidationError('Backup contains too many challenges'), /fler utmaningar än vad som stöds/],
    ['duplicates', new BackupValidationError('Backup contains duplicate challenge ids'), /samma utmaning flera gånger/],
    ['totals', new BackupValidationError('Challenge amounts do not add up to the target'), /stämmer inte med utmaningens mål/],
    ['config', new BackupValidationError('Challenge is longer than the supported maximum'), /inställningar i filen är ogiltiga/],
    ['unconfirmed replace', new BackupValidationError('Replacing all challenges needs explicit confirmation'), /bekräfta att allt ska ersättas/],
    ['legacy replace', new BackupValidationError('A legacy backup can only be imported as a new challenge'), /läggas till som ny utmaning/],
    ['unknown backup problem', new BackupValidationError('something else'), /Innehållet i filen är ogiltigt/],
  ]

  it.each(cases)('translates a backup problem: %s', (_label, error, expected) => {
    const message = errorMessage(error)
    expect(message).toMatch(expected)
    expect(message).toContain('Inget på enheten har ändrats.')
  })

  it('translates storage errors', () => {
    expect(errorMessage(new LegacyDataDamagedError('x'))).toBe('Sparad data från den tidigare versionen är skadad.')
    expect(errorMessage(new PersistenceVersionError())).toMatch(/nyare version av appen/)
    expect(errorMessage(new PersistenceIntegrityError('x'))).toMatch(/kunde inte verifieras/)
    expect(errorMessage(new PersistenceDatabaseError('x'))).toMatch(/Det gick inte att spara/)
  })

  it('translates the domain rules into plain Swedish', () => {
    expect(errorMessage(new Error('A current-day draw already exists'))).toBe('Dagens belopp är redan draget.')
    expect(errorMessage(new Error('This saving is already confirmed'))).toBe('Det här beloppet är redan bekräftat.')
    expect(errorMessage(new Error('Only a drawn amount can be confirmed'))).toBe('Dra dagens belopp först.')
    expect(errorMessage(new Error('A missed day cannot be drawn'))).toMatch(/missats/)
    expect(errorMessage(new Error('Date is outside the challenge'))).toMatch(/bara att dra och bekräfta dagens belopp/)
    expect(errorMessage(new Error('anything unexpected'))).toBe('Något gick fel. Försök igen.')
    expect(errorMessage('not even an error')).toBe('Något gick fel. Försök igen.')
  })

  it('never leaks technical terms to the user', () => {
    const everything = [...cases.map(([, error]) => error), new LegacyDataDamagedError('x'), new PersistenceVersionError(), new PersistenceIntegrityError('x'), new PersistenceDatabaseError('x')]
    for (const error of everything) expect(errorMessage(error)).not.toMatch(TECHNICAL)
  })
})

describe('labels', () => {
  it('labels imported and migrated challenges but not ones the user created', () => {
    const expected: Record<ChallengeOrigin, string | null> = {
      created: null,
      'legacy-v1-migration': 'Från tidigare version',
      'legacy-v1-backup': 'Importerad (äldre säkerhetskopia)',
      'backup-import': 'Importerad säkerhetskopia',
      'backup-restore': 'Återställd från säkerhetskopia',
    }
    for (const [origin, label] of Object.entries(expected)) expect(originLabel(origin as ChallengeOrigin)).toBe(label)
  })

  it('names unnamed challenges after their target', () => {
    expect(norm(challengeTitle(null, DEFAULT_CHALLENGE_CONFIG))).toBe('Utmaning 50 000 kr')
    expect(challengeTitle('Resekassan', DEFAULT_CHALLENGE_CONFIG)).toBe('Resekassan')
  })
})

describe('notices', () => {
  const config = DEFAULT_CHALLENGE_CONFIG

  it('explains a raised ceiling with the amounts involved', () => {
    const notice = planNotice({ kind: 'raised-ceiling', ceilingSek: 700, preferredMaximumSek: 500 }, config)
    expect(notice?.tone).toBe('warning')
    expect(norm(notice?.body ?? '')).toContain('upp till 700 kr')
    expect(norm(notice?.body ?? '')).toContain('500 kr')
  })

  it('explains an unreachable target without promising an extension', () => {
    const notice = planNotice({ kind: 'unreachable', unplannedSek: 1200 }, config)
    expect(notice?.tone).toBe('danger')
    expect(norm(notice?.body ?? '')).toContain('1 200 kr saknas')
    expect(notice?.body).toContain('flyttas inte automatiskt')
  })

  it('summarises an ended and a completed challenge, and says nothing when on track', () => {
    expect(norm(planNotice({ kind: 'ended-short', shortfallSek: 5000 }, config)?.body ?? '')).toContain('45 000 kr av 50 000 kr')
    expect(planNotice({ kind: 'completed' }, config)?.title).toBe('Målet är nått')
    expect(planNotice({ kind: 'on-track' }, config)).toBeNull()
  })

  it('describes each recovery result', () => {
    expect(recoveryNotice({ status: 'ok', ceiling: 500, message: '' }, config)).toMatchObject({ tone: 'info', title: 'Planen har räknats om' })
    expect(norm(recoveryNotice({ status: 'needs_higher_ceiling', ceiling: 625, message: '' }, config).body)).toContain('upp till 625 kr')
    const impossible = recoveryNotice({ status: 'impossible', ceiling: null, message: '' }, config)
    expect(impossible.tone).toBe('danger')
    expect(impossible.body).toContain('flyttas inte automatiskt')
  })
})
