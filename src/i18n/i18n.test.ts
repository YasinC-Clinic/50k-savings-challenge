import { describe, expect, it } from 'vitest'
import { DEFAULT_CHALLENGE_CONFIG, type Recovery } from '../domain/challenge'
import {
  BackupValidationError,
  LegacyDataDamagedError,
  PersistenceDatabaseError,
  PersistenceIntegrityError,
  PersistenceVersionError,
  type ChallengeOrigin,
} from '../persistence/savings-repository'
import { challengeTitle, dayStatusLabel, errorMessage, feedbackText, originLabel, planNotice, recoveryNotice } from './describe'
import { createFormatters } from './formatters'
import { createI18n } from './i18n'
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, LANGUAGES, isLanguage, readStoredLanguage, writeStoredLanguage } from './language'
import { en } from './messages.en'
import { sv } from './messages.sv'

const norm = (value: string) => value.replace(/[  ]/g, ' ')
const swedish = createI18n('sv')
const english = createI18n('en')

/** A minimal in-memory Storage, so the tests never touch the real browser storage. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  }
}

describe('language preference', () => {
  it('offers exactly Swedish and English and defaults to Swedish', () => {
    expect([...LANGUAGES]).toEqual(['sv', 'en'])
    expect(DEFAULT_LANGUAGE).toBe('sv')
    expect(isLanguage('sv') && isLanguage('en')).toBe(true)
    expect(isLanguage('de')).toBe(false)
    expect(isLanguage(null)).toBe(false)
  })

  it('is Swedish when nothing is stored (a new installation)', () => {
    expect(readStoredLanguage(fakeStorage())).toBe('sv')
  })

  it('reads an existing choice and never overrides it', () => {
    expect(readStoredLanguage(fakeStorage({ [LANGUAGE_STORAGE_KEY]: 'en' }))).toBe('en')
    expect(readStoredLanguage(fakeStorage({ [LANGUAGE_STORAGE_KEY]: 'sv' }))).toBe('sv')
  })

  it.each(['de', '', 'EN', 'english', '{"language":"en"}'])('falls back to Swedish for the invalid stored value %j', (value) => {
    expect(readStoredLanguage(fakeStorage({ [LANGUAGE_STORAGE_KEY]: value }))).toBe('sv')
  })

  it('writes the choice under one key and reads it back after "reinitialisation"', () => {
    const storage = fakeStorage()
    expect(writeStoredLanguage('en', storage)).toBe(true)
    expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en')
    expect(readStoredLanguage(storage)).toBe('en')
    writeStoredLanguage('sv', storage)
    expect(readStoredLanguage(storage)).toBe('sv')
    expect(storage.length).toBe(1)
  })

  it('never throws when storage is missing or blocked, and the app keeps working in Swedish', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(readStoredLanguage(blocked)).toBe('sv')
    expect(writeStoredLanguage('en', blocked)).toBe(false)
    expect(readStoredLanguage(null)).toBe('sv')
    expect(writeStoredLanguage('en', null)).toBe(false)
  })
})

type Leaf = [path: string, value: string]

/** Every text of a dictionary. Functions are called with sample arguments (1 and 2 for plurals, 'X' otherwise). */
function collect(value: unknown, path = ''): Leaf[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') return [[path, value]]
  if (typeof value === 'function') {
    const fn = value as (...args: unknown[]) => unknown
    const samples: unknown[][] = fn.length <= 1 ? [[1], [2], ['X']] : [Array<unknown>(fn.length).fill('X')]
    return samples.flatMap((args, index) => collect(fn(...args), `${path}()#${index}`))
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => collect(item, `${path}.${index}`))
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => collect(child, path ? `${path}.${key}` : key))
}

function shape(value: unknown, path = ''): string[] {
  if (value === null || value === undefined) return [`${path}:null`]
  if (typeof value === 'string') return [`${path}:string`]
  if (typeof value === 'function') return [`${path}:function`]
  if (Array.isArray(value)) return [`${path}:array(${value.length})`]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => shape(child, path ? `${path}.${key}` : key))
}

/** The only texts that are intentionally the same in both languages: the bilingual language selector. */
const BILINGUAL = new Set(['language.heading', 'language.svenska', 'language.english', 'settings.languageHeading', 'settings.languageGroup'])

/** Templates that only join already-formatted parameters with punctuation, so they contain no words to translate. */
const LANGUAGE_NEUTRAL_TEMPLATES = new Set(['calendar.dayLabel()#0', 'challenges.meta()#0'])

describe('the dictionaries', () => {
  it('have exactly the same structure in Swedish and English (keys, functions and list lengths)', () => {
    expect(shape(en).sort()).toEqual(shape(sv).sort())
  })

  it('have an English text for everything and it differs from the Swedish one (nothing was left untranslated)', () => {
    const swedishTexts = new Map(collect(sv))
    const untranslated = collect(en)
      .filter(([path, text]) => swedishTexts.get(path) === text && !BILINGUAL.has(path) && !LANGUAGE_NEUTRAL_TEMPLATES.has(path))
      .map(([path, text]) => `${path}: ${text}`)
    expect(untranslated).toEqual([])
  })

  it('contain no Swedish letters or words in English (only the bilingual selector heading)', () => {
    const swedishWords = /\b(och|att|det|som|är|inte|för|med|din|dina|ditt|dagar|utmaning|utmaningar|spara|sparat|belopp|nyår|månad)\b/i
    const leaks = collect(en)
      .filter(([path]) => !BILINGUAL.has(path))
      .filter(([, text]) => /[åäöÅÄÖ]/.test(text) || swedishWords.test(text))
      .map(([path, text]) => `${path}: ${text}`)
    expect(leaks).toEqual([])
  })

  it('contain no English words in Swedish (only the bilingual selector)', () => {
    const englishWords = /\b(the|and|your|you|with|this|that|are|not|have|from|will|cancel|save|settings|challenge|today)\b/i
    const leaks = collect(sv)
      .filter(([path]) => !BILINGUAL.has(path))
      .filter(([, text]) => englishWords.test(text))
      .map(([path, text]) => `${path}: ${text}`)
    expect(leaks).toEqual([])
  })

  it('name the language selector the same way in both languages', () => {
    expect(sv.language.svenska).toBe('Svenska 🇸🇪')
    expect(sv.language.english).toBe('English 🇬🇧')
    expect(en.language).toEqual(sv.language)
  })

  it('say in both languages that the app is not connected to a bank', () => {
    expect(sv.settings.noBank).toMatch(/inte kopplad till någon bank/)
    expect(en.settings.noBank).toMatch(/not connected to any bank/)
    expect(sv.home.daily.drawnBody).toMatch(/via din bank/)
    expect(en.home.daily.drawnBody).toMatch(/through your bank/)
  })

  it('create an I18n for each language and cache it', () => {
    expect(createI18n('sv')).toBe(swedish)
    expect(swedish.locale).toBe('sv-SE')
    expect(english.locale).toBe('en-GB')
    expect(swedish.t).toBe(sv)
    expect(english.t).toBe(en)
  })
})

describe('formatting follows the language and never changes a value', () => {
  const svFormat = createFormatters('sv-SE')
  const enFormat = createFormatters('en-GB')

  it.each([
    ['2026-11-08', '8 nov. 2026', '8 Nov 2026'],
    ['2026-12-31', '31 dec. 2026', '31 Dec 2026'],
    ['2027-01-01', '1 jan. 2027', '1 Jan 2027'],
    ['2028-02-29', '29 feb. 2028', '29 Feb 2028'],
    ['2027-03-28', '28 mars 2027', '28 Mar 2027'],
    ['2027-10-31', '31 okt. 2027', '31 Oct 2027'],
  ])('formats %s as Swedish "%s" and English "%s"', (key, swedishDate, englishDate) => {
    expect(svFormat.date(key)).toBe(swedishDate)
    expect(enFormat.date(key)).toBe(englishDate)
  })

  it('formats the long day with the weekday in each language', () => {
    expect(svFormat.dayLong('2026-11-08')).toBe('söndag 8 november')
    expect(norm(enFormat.dayLong('2026-11-08'))).toMatch(/^Sunday,? 8 November$/)
  })

  it('formats months and ranges', () => {
    expect(svFormat.monthYear('2026-11')).toBe('november 2026')
    expect(enFormat.monthYear('2026-11')).toBe('November 2026')
    expect(svFormat.range('2027-01-01', '2027-06-30')).toBe('1 jan. 2027 – 30 juni 2027')
    expect(enFormat.range('2027-01-01', '2027-06-30')).toBe('1 Jan 2027 – 30 Jun 2027')
  })

  it('keeps the currency SEK in both languages', () => {
    expect(norm(svFormat.sek(50_000))).toBe('50 000 kr')
    expect(norm(enFormat.sek(50_000))).toBe('SEK 50,000')
    expect(norm(svFormat.sek(310))).toBe('310 kr')
    expect(norm(enFormat.sek(310))).toBe('SEK 310')
  })

  it('formats percentages with the local decimal separator', () => {
    expect(norm(svFormat.percent(12.5))).toBe('12,5 %')
    expect(enFormat.percent(12.5)).toBe('12.5%')
  })

  it('is stable for every day of a year including the daylight-saving days (a date key never moves)', () => {
    for (const month of ['01', '03', '10', '12']) {
      for (let day = 1; day <= 28; day += 1) {
        const key = `2027-${month}-${String(day).padStart(2, '0')}`
        expect(Number(svFormat.date(key).split(' ')[0])).toBe(day)
        expect(Number(enFormat.date(key).split(' ')[0])).toBe(day)
      }
    }
  })
})

describe('describing errors, labels and notices in both languages', () => {
  const backupCases: Array<[string, string, string, RegExp]> = [
    ['not JSON', 'Backup is not valid JSON', 'går inte att läsa som en säkerhetskopia', /cannot be read as a backup/],
    ['wrong format', 'Backup format is not supported', 'ingen säkerhetskopia från den här appen', /not a backup from this app/],
    ['unknown version', 'Backup version is not supported', 'okänd eller nyare version', /unknown or newer version/],
    ['too large', 'Backup is too large', 'för stor', /too large/],
    ['too many', 'Backup contains too many challenges', 'fler utmaningar än vad som stöds', /more challenges than are supported/],
    ['duplicates', 'Backup contains duplicate challenge ids', 'samma utmaning flera gånger', /same challenge more than once/],
    ['totals', 'Challenge amounts do not add up to the target', 'stämmer inte med utmaningens mål', /do not match the challenge/],
    ['config', 'Challenge is longer than the supported maximum', 'inställningar i filen är ogiltiga', /settings in the file are invalid/],
    ['unconfirmed replace', 'Replacing all challenges needs explicit confirmation', 'bekräfta att allt ska ersättas', /confirm that everything should be replaced/],
    ['legacy replace', 'A legacy backup can only be imported as a new challenge', 'läggas till som ny utmaning', /added as a new challenge/],
    ['unknown problem', 'something else', 'Innehållet i filen är ogiltigt', /contents of the file are invalid/],
  ]

  it.each(backupCases)('translates the backup problem "%s"', (_label, original, swedishPart, englishPattern) => {
    const error = new BackupValidationError(original)
    expect(errorMessage(error, swedish)).toContain(swedishPart)
    expect(errorMessage(error, swedish)).toContain('Inget på enheten har ändrats.')
    expect(errorMessage(error, english)).toMatch(englishPattern)
    expect(errorMessage(error, english)).toContain('Nothing on the device has been changed.')
  })

  it('translates storage errors', () => {
    expect(errorMessage(new LegacyDataDamagedError('x'), swedish)).toBe('Sparad data från den tidigare versionen är skadad.')
    expect(errorMessage(new LegacyDataDamagedError('x'), english)).toBe('The data stored by the previous version is damaged.')
    expect(errorMessage(new PersistenceVersionError(), swedish)).toMatch(/nyare version av appen/)
    expect(errorMessage(new PersistenceVersionError(), english)).toMatch(/newer version of the app/)
    expect(errorMessage(new PersistenceIntegrityError('x'), swedish)).toMatch(/kunde inte verifieras/)
    expect(errorMessage(new PersistenceIntegrityError('x'), english)).toMatch(/could not be verified/)
    expect(errorMessage(new PersistenceDatabaseError('x'), swedish)).toMatch(/Det gick inte att spara/)
    expect(errorMessage(new PersistenceDatabaseError('x'), english)).toMatch(/Could not save/)
  })

  it('translates the domain rules', () => {
    const cases: Array<[string, string, string]> = [
      ['A current-day draw already exists', 'Dagens belopp är redan draget.', "Today's amount has already been drawn."],
      ['This saving is already confirmed', 'Det här beloppet är redan bekräftat.', 'This amount has already been confirmed.'],
      ['Only a drawn amount can be confirmed', 'Dra dagens belopp först.', "Draw today's amount first."],
      ['A missed day cannot be drawn', 'Den här dagen har missats och kan inte dras.', 'This day was missed and cannot be drawn.'],
      ['Date is outside the challenge', 'Det går bara att dra och bekräfta dagens belopp.', "Only today's amount can be drawn and confirmed."],
      ['anything unexpected', 'Något gick fel. Försök igen.', 'Something went wrong. Try again.'],
    ]
    for (const [original, swedishText, englishText] of cases) {
      expect(errorMessage(new Error(original), swedish)).toBe(swedishText)
      expect(errorMessage(new Error(original), english)).toBe(englishText)
    }
    expect(errorMessage('not even an error', swedish)).toBe('Något gick fel. Försök igen.')
    expect(errorMessage('not even an error', english)).toBe('Something went wrong. Try again.')
  })

  it('never leaks technical terms in either language', () => {
    const technical = /indexeddb|dexie|transaction|schema|primary key|database|table|json|validation/i
    const errors = [
      ...backupCases.map(([, original]) => new BackupValidationError(original)),
      new LegacyDataDamagedError('x'),
      new PersistenceVersionError(),
      new PersistenceIntegrityError('x'),
      new PersistenceDatabaseError('x'),
    ]
    for (const error of errors) {
      expect(errorMessage(error, swedish)).not.toMatch(technical)
      expect(errorMessage(error, english)).not.toMatch(technical)
    }
  })

  it('describes feedback descriptors in the language that is selected now', () => {
    expect(feedbackText({ kind: 'confirmed' }, swedish)).toBe('Sparandet är bekräftat. Bra jobbat!')
    expect(feedbackText({ kind: 'confirmed' }, english)).toBe('Your saving is confirmed. Well done!')
    expect(feedbackText({ kind: 'imported', count: 1 }, english)).toBe('The challenge was imported as a new challenge.')
    expect(feedbackText({ kind: 'imported', count: 3 }, english)).toBe('3 challenges were imported as new.')
    expect(feedbackText({ kind: 'imported', count: 3 }, swedish)).toBe('3 utmaningar är importerade som nya.')
    expect(feedbackText({ kind: 'error', error: new BackupValidationError('Backup is not valid JSON') }, english)).toContain('cannot be read')
  })

  it('labels imported and migrated challenges but not ones the user created', () => {
    const swedishLabels: Record<ChallengeOrigin, string | null> = {
      created: null,
      'legacy-v1-migration': 'Från tidigare version',
      'legacy-v1-backup': 'Importerad (äldre säkerhetskopia)',
      'backup-import': 'Importerad säkerhetskopia',
      'backup-restore': 'Återställd från säkerhetskopia',
    }
    for (const [origin, label] of Object.entries(swedishLabels)) expect(originLabel(origin as ChallengeOrigin, swedish)).toBe(label)
    expect(originLabel('created', english)).toBeNull()
    expect(originLabel('legacy-v1-migration', english)).toBe('From the previous version')
    expect(originLabel('backup-import', english)).toBe('Imported backup')
  })

  it('labels day statuses and names unnamed challenges after their target', () => {
    expect(dayStatusLabel('confirmed', swedish)).toBe('Bekräftad')
    expect(dayStatusLabel('confirmed', english)).toBe('Confirmed')
    expect(norm(challengeTitle(null, DEFAULT_CHALLENGE_CONFIG, swedish))).toBe('Utmaning 50 000 kr')
    expect(norm(challengeTitle(null, DEFAULT_CHALLENGE_CONFIG, english))).toBe('Challenge SEK 50,000')
    expect(challengeTitle('Resekassan', DEFAULT_CHALLENGE_CONFIG, english)).toBe('Resekassan')
  })

  it('explains a raised ceiling and an unreachable target with the challenge limits, in both languages', () => {
    const raised = { kind: 'raised-ceiling', ceilingSek: 700, preferredMaximumSek: 500 } as const
    expect(norm(planNotice(raised, DEFAULT_CHALLENGE_CONFIG, swedish)?.body ?? '')).toContain('upp till 700 kr')
    expect(norm(planNotice(raised, DEFAULT_CHALLENGE_CONFIG, english)?.body ?? '')).toContain('up to SEK 700')
    expect(planNotice(raised, DEFAULT_CHALLENGE_CONFIG, english)?.title).toBe('A higher daily amount is needed')

    const unreachable = { kind: 'unreachable', unplannedSek: 1200 } as const
    expect(norm(planNotice(unreachable, DEFAULT_CHALLENGE_CONFIG, swedish)?.body ?? '')).toContain('med dagsbelopp mellan 50 kr och 500 kr')
    expect(norm(planNotice(unreachable, DEFAULT_CHALLENGE_CONFIG, english)?.body ?? '')).toContain('daily amounts between SEK 50 and SEK 500')
    expect(planNotice(unreachable, DEFAULT_CHALLENGE_CONFIG, english)?.body).toContain('not changed automatically')
  })

  it('summarises ended and completed challenges and is silent when on track', () => {
    expect(norm(planNotice({ kind: 'ended-short', shortfallSek: 5000 }, DEFAULT_CHALLENGE_CONFIG, english)?.body ?? '')).toContain('SEK 45,000 of SEK 50,000')
    expect(norm(planNotice({ kind: 'ended-short', shortfallSek: 5000 }, DEFAULT_CHALLENGE_CONFIG, swedish)?.body ?? '')).toContain('45 000 kr av 50 000 kr')
    expect(planNotice({ kind: 'completed' }, DEFAULT_CHALLENGE_CONFIG, english)?.title).toBe('Goal reached')
    expect(planNotice({ kind: 'completed' }, DEFAULT_CHALLENGE_CONFIG, swedish)?.title).toBe('Målet är nått')
    expect(planNotice({ kind: 'on-track' }, DEFAULT_CHALLENGE_CONFIG, english)).toBeNull()
  })

  it('describes each recovery result in both languages and never says the deadline moves', () => {
    const ok: Recovery = { status: 'ok', ceiling: 500, message: '' }
    const higher: Recovery = { status: 'needs_higher_ceiling', ceiling: 625, message: '' }
    const impossible: Recovery = { status: 'impossible', ceiling: null, message: '' }
    expect(recoveryNotice(ok, DEFAULT_CHALLENGE_CONFIG, english)).toMatchObject({ tone: 'info', title: 'The plan has been recalculated' })
    expect(recoveryNotice(ok, DEFAULT_CHALLENGE_CONFIG, swedish)).toMatchObject({ tone: 'info', title: 'Planen har räknats om' })
    expect(norm(recoveryNotice(higher, DEFAULT_CHALLENGE_CONFIG, english).body)).toContain('up to SEK 625')
    expect(norm(recoveryNotice(higher, DEFAULT_CHALLENGE_CONFIG, swedish).body)).toContain('upp till 625 kr')
    expect(recoveryNotice(impossible, DEFAULT_CHALLENGE_CONFIG, english).body).toContain('not extended automatically')
    expect(recoveryNotice(impossible, DEFAULT_CHALLENGE_CONFIG, swedish).body).toContain('flyttas inte automatiskt')
  })
})
