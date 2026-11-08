// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { configForDuration, createChallenge, type ChallengeConfig } from '../domain/challenge'
import { createI18n } from '../i18n/i18n'
import { LANGUAGE_STORAGE_KEY, type Language } from '../i18n/language'
import { SavingsDatabase, SavingsRepository } from '../persistence/savings-repository'
import { playedChallenge, seedV1Database, snapshotRawTables, uniqueName, v1BackupJson, withDay } from '../persistence/testing/v1-fixtures'

configure({ asyncUtilTimeout: 5000 })

const databases: SavingsDatabase[] = []
const names: string[] = []
const norm = (value: string | null | undefined) => (value ?? '').replace(/[  ]/g, ' ')
const sixMonths = (): ChallengeConfig => configForDuration('2026-11-08', 6)
const BACKUP_TIME = '2027-01-01T10:00:00.000Z'

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  databases.splice(0).forEach((database) => database.close())
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)))
  localStorage.clear()
  document.documentElement.lang = ''
})

/** An isolated database and a clock fixed at 2026-11-08 11:00 in Stockholm. */
function setup(name = uniqueName('lang')) {
  names.push(name)
  const database = new SavingsDatabase(name)
  databases.push(database)
  const repository = new SavingsRepository(database)
  return { name, repository, services: { repository, now: () => new Date('2026-11-08T11:00:00+01:00') } }
}

function jsonFile(text: string): File {
  const file = new File([text], 'backup.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: async () => text })
  return file
}

/** Stops real downloads in jsdom and returns the spy, so a test can wait until the download happened. */
function captureDownloads() {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:test' })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined })
  return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
}

// ---------------------------------------------------------------------------------------------
// Language audit helpers: every visible text AND every accessibility label of the current screen
// ---------------------------------------------------------------------------------------------

const BILINGUAL_TEXT = ['Språk / Language', 'Svenska 🇸🇪', 'English 🇬🇧']
const SWEDISH_IN_ENGLISH = /[åäöÅÄÖ]|\b(och|att|det|som|är|inte|för|med|din|dina|ditt|dagar|utmaning|utmaningar|spara|sparat|belopp|nyår|månad|idag)\b/giu
const ENGLISH_IN_SWEDISH =
  /\b(the|and|your|you|with|this|that|are|not|have|from|will|Cancel|Save|Settings|Calendar|Challenges?|Today|Confirm|Confirmed|Missed|Import|Imported|Export|Backup|Saved|Draw|Drawn)\b/gu

function allVisibleText(): string {
  const parts = [document.body.textContent ?? '']
  document.querySelectorAll('[aria-label],[title],[placeholder],[alt]').forEach((element) => {
    for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
      const value = element.getAttribute(attribute)
      if (value) parts.push(value)
    }
  })
  return BILINGUAL_TEXT.reduce((text, bilingual) => text.split(bilingual).join(' '), norm(parts.join('\n')))
}

/** Fails with the offending words, so a missing translation is easy to find. */
function expectOnly(language: Language, where: string): void {
  const text = allVisibleText()
  const found = (text.match(language === 'en' ? SWEDISH_IN_ENGLISH : ENGLISH_IN_SWEDISH) ?? []).map((word) => word.toLowerCase())
  expect({ where, language, found: [...new Set(found)] }).toEqual({ where, language, found: [] })
  expect(document.documentElement.lang).toBe(language)
}

const user = () => userEvent.setup()
const goTo = async (u: ReturnType<typeof userEvent.setup>, label: string) => u.click(await screen.findByRole('button', { name: label }))

async function chooseLanguage(u: ReturnType<typeof userEvent.setup>, language: Language) {
  await u.click(await screen.findByRole('radio', { name: language === 'sv' ? /Svenska/ : /English/ }))
}

describe('default language and selection', () => {
  it('is Swedish for a new installation and writes nothing until the user chooses', async () => {
    const { services } = setup()
    render(<App services={services} />)
    expect(await screen.findByText('Skapa din första utmaning')).toBeTruthy()
    expect(document.documentElement.lang).toBe('sv')
    expect(document.title).toBe('50K Sparutmaning')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()
    expectOnly('sv', 'welcome screen')
  })

  it('offers "Svenska 🇸🇪" and "English 🇬🇧" in Settings, with Swedish selected by default', async () => {
    const { services } = setup()
    const u = user()
    render(<App services={services} />)
    await goTo(u, 'Inställningar')
    const group = await screen.findByRole('radiogroup', { name: 'Språk / Language' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.textContent)).toEqual(['Svenska 🇸🇪', 'English 🇬🇧'])
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false'])
  })

  it('switches the whole interface to English immediately, without a reload', async () => {
    const { services } = setup()
    const u = user()
    render(<App services={services} />)
    await goTo(u, 'Inställningar')
    expect(await screen.findByRole('heading', { name: 'Inställningar' })).toBeTruthy()

    await chooseLanguage(u, 'en')

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Inställningar' })).toBeNull()
    for (const tab of ['Today', 'Calendar', 'Challenges', 'Settings']) expect(screen.getByRole('button', { name: tab })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Main menu' })).toBeTruthy()
    expect(document.documentElement.lang).toBe('en')
    expect(document.title).toBe('50K Savings Challenge')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en')
    expect(screen.getByRole('radio', { name: /English/ }).getAttribute('aria-checked')).toBe('true')
    expectOnly('en', 'settings after switching')
  })

  it('can switch back to Swedish', async () => {
    const { services } = setup()
    const u = user()
    render(<App services={services} />)
    await goTo(u, 'Inställningar')
    await chooseLanguage(u, 'en')
    await chooseLanguage(u, 'sv')
    expect(screen.getByRole('heading', { name: 'Inställningar' })).toBeTruthy()
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('sv')
    expectOnly('sv', 'settings after switching back')
  })

  it('updates the content of every screen when the language changes (home, amounts, dates)', async () => {
    const { services, repository } = setup()
    await repository.saveChallenge(createChallenge('lang', sixMonths(), 'one'), { name: 'Alfa' })
    const u = user()
    render(<App services={services} />)
    expect(await screen.findByRole('button', { name: 'Dra dagens belopp' })).toBeTruthy()
    expect(norm(document.body.textContent)).toContain('söndag 8 november')
    expect(norm(document.body.textContent)).toContain('0 kr')

    await goTo(u, 'Inställningar')
    await chooseLanguage(u, 'en')
    await goTo(u, 'Today')
    expect(await screen.findByRole('button', { name: "Draw today's amount" })).toBeTruthy()
    expect(norm(document.body.textContent)).toMatch(/Sunday,? 8 November/)
    expect(norm(document.body.textContent)).toContain('SEK 0')
    expect(norm(document.body.textContent)).toContain('Confirmed savings')

    await goTo(u, 'Settings')
    await chooseLanguage(u, 'sv')
    await goTo(u, 'Idag')
    expect(await screen.findByRole('button', { name: 'Dra dagens belopp' })).toBeTruthy()
  })
})

describe('the choice persists', () => {
  it('survives a reload: a new instance of the app starts in the saved language', async () => {
    const { services, repository } = setup()
    await repository.saveChallenge(createChallenge('lang', sixMonths(), 'one'), { name: 'Alfa' })
    const u = user()
    const first = render(<App services={services} />)
    await goTo(u, 'Inställningar')
    await chooseLanguage(u, 'en')
    first.unmount()

    render(<App services={services} />)
    expect(await screen.findByRole('button', { name: "Draw today's amount" })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Calendar' })).toBeTruthy()
    expect(document.documentElement.lang).toBe('en')
  })

  it('shows the saved language from the very first screen (even while loading)', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en')
    const { services } = setup()
    render(<App services={services} />)
    expect(screen.getByText('Preparing your savings…')).toBeTruthy()
    expect(await screen.findByText('Create your first challenge')).toBeTruthy()
  })

  it('never overrides an existing selection: a stored Swedish choice stays Swedish', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'sv')
    const { services } = setup()
    render(<App services={services} />)
    expect(await screen.findByText('Skapa din första utmaning')).toBeTruthy()
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('sv')
  })

  it.each(['de', '', 'EN', 'null'])('falls back to Swedish for the invalid stored value %j without overwriting it', async (stored) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, stored)
    const { services } = setup()
    render(<App services={services} />)
    expect(await screen.findByText('Skapa din första utmaning')).toBeTruthy()
    expect(document.documentElement.lang).toBe('sv')
  })

  it('follows a change made in another tab or window', async () => {
    const { services } = setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    fireEvent(window, new StorageEvent('storage', { key: 'something-else', newValue: 'en' }))
    expect(screen.getByText('Skapa din första utmaning')).toBeTruthy()
    fireEvent(window, new StorageEvent('storage', { key: LANGUAGE_STORAGE_KEY, newValue: 'en' }))
    expect(await screen.findByText('Create your first challenge')).toBeTruthy()
  })

  it('keeps working when the browser refuses to store the choice (the language still switches for this session)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is blocked')
    })
    const { services } = setup()
    const u = user()
    render(<App services={services} />)
    await goTo(u, 'Inställningar')
    await chooseLanguage(u, 'en')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
  })

  it('uses the saved language on the recovery screen, which appears before the database can be read', async () => {
    const legacy = playedChallenge('damaged-lang')
    for (const [language, heading] of [['sv', 'Din tidigare data är skadad'], ['en', 'Your earlier data is damaged']] as const) {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
      const { services, name } = setup()
      await seedV1Database(name, { activeRow: { id: 'active', seed: legacy.seed }, entries: withDay(legacy.days, 20, { amount: 0 }) })
      const view = render(<App services={services} />)
      expect(await screen.findByText(heading)).toBeTruthy()
      view.unmount()
    }
  })
})

describe('switching language never touches the savings data', () => {
  it('leaves every challenge, entry, confirmation, setting and backup byte-for-byte unchanged', async () => {
    const { services, repository, name } = setup()
    const first = createChallenge('data-one', sixMonths(), 'one')
    await repository.saveChallenge(first, { name: 'Alfa' })
    await repository.saveChallenge(createChallenge('data-two', { ...sixMonths(), targetSek: 20_000, initialMinimumSek: 100, preferredMaximumSek: 300 }, 'two'), { name: 'Beta' })
    await repository.saveChallenge({ ...first, days: first.days.map((day, index) => (index === 0 ? { ...day, status: 'drawn' as const } : day)) })
    await repository.saveChallenge({ ...first, days: first.days.map((day, index) => (index === 0 ? { ...day, status: 'confirmed' as const } : day)) })
    await repository.setActiveChallenge('one')
    const tablesBefore = await snapshotRawTables(name)
    const backupBefore = await repository.exportBackup(BACKUP_TIME)
    const challengesBefore = await repository.listChallenges()

    const u = user()
    render(<App services={services} />)
    await screen.findByText('Alfa')
    await goTo(u, 'Inställningar')
    for (const language of ['en', 'sv', 'en', 'sv', 'en'] as const) await chooseLanguage(u, language)
    await goTo(u, 'Calendar')
    await goTo(u, 'Challenges')
    await goTo(u, 'Settings')

    expect(await snapshotRawTables(name)).toEqual(tablesBefore)
    expect(await repository.exportBackup(BACKUP_TIME)).toBe(backupBefore)
    expect(await repository.listChallenges()).toEqual(challengesBefore)
    expect(await repository.activeChallengeId()).toBe('one')
  })

  it('stores the language only as a device preference: not in the database and not in any backup', async () => {
    const { services, repository, name } = setup()
    await repository.saveChallenge(createChallenge('pref', sixMonths(), 'one'), { name: 'Alfa' })
    const u = user()
    render(<App services={services} />)
    await goTo(u, 'Inställningar')
    await chooseLanguage(u, 'en')

    expect(JSON.stringify(await snapshotRawTables(name))).not.toMatch(/language|spar\.language/i)
    expect(await repository.exportBackup(BACKUP_TIME)).not.toMatch(/language|spar\.language/i)
    expect((await repository.database.appMeta.toArray()).map((row) => row.key).sort()).toEqual(['activeChallengeId', 'legacyMigration'])
    expect(Object.keys(localStorage)).toEqual([LANGUAGE_STORAGE_KEY])
  })

  it('is not affected by restoring a backup: the saved language stays', async () => {
    const source = setup()
    await source.repository.saveChallenge(createChallenge('restore', sixMonths(), 'src'), { name: 'Alfa' })
    const backup = await source.repository.exportBackup(BACKUP_TIME)
    const { repository } = setup()
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en')
    await repository.restoreBackup(backup, { mode: 'replace', confirmReplace: true })
    await repository.restoreBackup(backup, { mode: 'import-as-new' })
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en')
  })

  it('shows the same saved amount in both languages and records the same confirmed amount', async () => {
    const { services, repository } = setup()
    await repository.saveChallenge(createChallenge('same', sixMonths(), 'one'), { name: 'Alfa' })
    const u = user()
    render(<App services={services} />)
    await goTo(u, 'Inställningar')
    await chooseLanguage(u, 'en')
    await goTo(u, 'Today')
    await u.click(await screen.findByRole('button', { name: "Draw today's amount" }))
    await u.click(await screen.findByRole('button', { name: 'I have saved the amount' }))
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Yes, I have saved it' }))
    await screen.findByText('Saved today')

    const stored = (await repository.loadChallenge('one'))!.days[0]
    expect(stored.status).toBe('confirmed')
    expect(norm(document.querySelector('.balance-amount')?.textContent)).toBe(norm(createI18n('en').fmt.sek(stored.amount)))

    await goTo(u, 'Settings')
    await chooseLanguage(u, 'sv')
    await goTo(u, 'Idag')
    await screen.findByText('Sparat idag')
    expect(norm(document.querySelector('.balance-amount')?.textContent)).toBe(norm(createI18n('sv').fmt.sek(stored.amount)))
    expect((await repository.loadChallenge('one'))!.days[0]).toEqual(stored)
  })
})

describe('dates follow the language', () => {
  it('formats the creation summary, the calendar and the challenge list for each language', async () => {
    const { services, repository } = setup()
    await repository.saveChallenge(createChallenge('dates', { ...sixMonths(), startDate: '2027-01-01', endDate: '2027-06-30', targetSek: 50_000 }, 'one'), { name: 'Alfa' })
    const u = user()
    render(<App services={services} />)

    await goTo(u, 'Kalender')
    expect(await screen.findByText('januari 2027')).toBeTruthy()
    await goTo(u, 'Utmaningar')
    expect(norm(document.body.textContent)).toContain('1 jan. 2027 – 30 juni 2027 · 181 dagar')

    await goTo(u, 'Inställningar')
    await chooseLanguage(u, 'en')
    await goTo(u, 'Calendar')
    expect(await screen.findByText('January 2027')).toBeTruthy()
    expect(screen.getAllByText('Mon').length).toBeGreaterThan(0)
    await goTo(u, 'Challenges')
    expect(norm(document.body.textContent)).toContain('1 Jan 2027 – 30 Jun 2027 · 181 days')
  })

  it('shows the calculated start and end date of a new challenge in each language', async () => {
    const { services } = setup()
    const u = user()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    expect(norm(screen.getByLabelText('Sammanfattning av utmaningen').textContent)).toContain('Startdatum8 nov. 2026 (idag)')
    expect(norm(screen.getByLabelText('Sammanfattning av utmaningen').textContent)).toContain('Slutdatum8 maj 2027')

    await goTo(u, 'Inställningar')
    await chooseLanguage(u, 'en')
    await goTo(u, 'Today')
    const summary = norm((await screen.findByLabelText('Challenge summary')).textContent)
    expect(summary).toContain('Start date8 Nov 2026 (today)')
    expect(summary).toContain('End date8 May 2027')
    expect(summary).toContain('Number of saving days182 days')
    expect(summary).toContain('Savings goalSEK 50,000')
    expect(summary).toContain('Daily amountSEK 50 – SEK 500')
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toContain('Until New Year')
  })

  it('keeps stored dates untouched: the same calendar dates exist before and after switching', async () => {
    const { services, repository } = setup()
    await repository.saveChallenge(createChallenge('keep', sixMonths(), 'one'), { name: 'Alfa' })
    const before = (await repository.loadChallenge('one'))!.days.map((day) => day.date)
    const u = user()
    render(<App services={services} />)
    await goTo(u, 'Inställningar')
    await chooseLanguage(u, 'en')
    await goTo(u, 'Calendar')
    await goTo(u, 'Settings')
    await chooseLanguage(u, 'sv')
    expect((await repository.loadChallenge('one'))!.days.map((day) => day.date)).toEqual(before)
    expect(before[0]).toBe('2026-11-08')
    expect(before.at(-1)).toBe('2027-05-08')
  })
})

describe('messages already on screen change language with the interface', () => {
  it('re-translates an error that is visible when the language is switched', async () => {
    const { services, repository } = setup()
    await repository.saveChallenge(createChallenge('err', sixMonths(), 'one'), { name: 'Alfa' })
    const u = user()
    render(<App services={services} />)
    await goTo(u, 'Inställningar')
    await chooseLanguage(u, 'en')
    await u.upload(await screen.findByLabelText('Choose backup file'), jsonFile('this is not json'))
    expect((await screen.findByRole('alert')).textContent).toContain('The file cannot be read as a backup. Nothing on the device has been changed.')

    await chooseLanguage(u, 'sv')
    const swedishAlert = (await screen.findByRole('alert')).textContent
    expect(swedishAlert).toContain('Filen går inte att läsa som en säkerhetskopia. Inget på enheten har ändrats.')
    expect(swedishAlert).not.toContain('cannot be read')
  })
})

// ---------------------------------------------------------------------------------------------
// Screen-by-screen audit: every screen, dialog, error and state, in both languages
// ---------------------------------------------------------------------------------------------

async function walkEveryScreen(language: Language) {
  const { t } = createI18n(language)
  const downloadClick = captureDownloads()
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language)

  const source = setup()
  await source.repository.saveChallenge(createChallenge('src-a', sixMonths(), 'src-a'), { name: 'Alfa' })
  await source.repository.saveChallenge(createChallenge('src-b', configForDuration('2026-11-08', 1, 6_000, { minimumSek: 100, maximumSek: 300 }), 'src-b'), { name: 'Beta' })
  const v2Backup = await source.repository.exportBackup(BACKUP_TIME)

  const { services, repository } = setup()
  await repository.saveChallenge(createChallenge('walk-a', sixMonths(), 'one'), { name: 'Alfa' })
  await repository.saveChallenge(createChallenge('walk-b', { ...sixMonths(), startDate: '2027-01-01', endDate: '2027-06-30' }, 'two'), { name: 'Beta' })
  await repository.setActiveChallenge('one')

  const u = user()
  render(<App services={services} />)
  await screen.findByRole('button', { name: t.home.daily.drawButton })
  expectOnly(language, 'home: not drawn yet')

  await u.click(screen.getByRole('button', { name: t.home.daily.drawButton }))
  await screen.findByText(t.home.daily.drawnLabel)
  expectOnly(language, 'home: drawn, with message')

  await u.click(screen.getByRole('button', { name: t.home.daily.confirmButton }))
  await screen.findByRole('dialog')
  expectOnly(language, 'confirmation dialog')
  await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: t.home.confirmDialog.confirm }))
  await screen.findByText(t.home.daily.confirmedLabel)
  expectOnly(language, 'home: confirmed')

  await goTo(u, t.app.tabs.calendar)
  await screen.findByText(t.calendar.heading)
  expectOnly(language, 'calendar')

  await goTo(u, t.app.tabs.challenges)
  await screen.findByText(t.challenges.current)
  expectOnly(language, 'challenge list')
  await u.click(screen.getByRole('button', { name: new RegExp(t.challenges.newButton) }))
  await screen.findByText(t.form.legend, { selector: 'legend' })
  expectOnly(language, 'new challenge form')
  await u.click(screen.getByRole('radio', { name: t.form.duration.newYear }))
  await screen.findByText(/\S/, { selector: '.field-error' })
  expectOnly(language, 'new challenge form: target does not fit the period')
  const minimum = screen.getByLabelText(t.form.minLabel)
  await u.clear(minimum)
  await u.type(minimum, '9999')
  await screen.findByText(t.form.errors.minAboveMax)
  expectOnly(language, 'new challenge form: minimum above maximum')
  await u.click(screen.getAllByRole('button', { name: t.form.cancel })[0])
  await u.click(screen.getAllByRole('button', { name: t.challenges.rename })[0])
  expectOnly(language, 'rename')

  await goTo(u, t.app.tabs.settings)
  await screen.findByText(t.settings.backupHeading)
  expectOnly(language, 'settings')

  await u.upload(screen.getByLabelText(t.settings.chooseFile), jsonFile(v1BackupJson(playedChallenge('audit-v1'))))
  await within(await screen.findByRole('dialog')).findByText(t.importDialog.legacyBold)
  expectOnly(language, 'import dialog: old backup')
  await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: t.importDialog.cancel }))

  await u.upload(screen.getByLabelText(t.settings.chooseFile), jsonFile(v2Backup))
  const dialog = await screen.findByRole('dialog')
  expectOnly(language, 'import dialog: new backup')
  await u.click(within(dialog).getByRole('radio', { name: new RegExp(t.importDialog.replaceTitle) }))
  await within(dialog).findByText(t.importDialog.warningLabel)
  expectOnly(language, 'import dialog: replace warning')
  await u.click(within(dialog).getByRole('button', { name: t.importDialog.cancel }))

  await u.upload(screen.getByLabelText(t.settings.chooseFile), jsonFile('not a backup'))
  await screen.findByRole('alert')
  expectOnly(language, 'settings: invalid file error')

  await u.click(screen.getByRole('button', { name: t.settings.saveRaw }))
  await waitFor(() => expect(downloadClick).toHaveBeenCalled())
  expect(downloadClick.mock.contexts[0]).toMatchObject({ download: t.files.raw('2026-11-08') })
  expectOnly(language, 'settings: after saving raw data')
}

describe('every screen is fully translated (automatic audit of all visible text and accessibility labels)', () => {
  it('Swedish: no English text on any screen, dialog, message or label', async () => {
    await walkEveryScreen('sv')
  }, 60_000)

  it('English: no Swedish text on any screen, dialog, message or label', async () => {
    await walkEveryScreen('en')
  }, 60_000)

  it.each(['sv', 'en'] as const)('%s: the welcome screen with validation errors is fully translated', async (language) => {
    const { t } = createI18n(language)
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    const { services } = setup()
    const u = user()
    render(<App services={services} />)
    await screen.findByText(t.onboarding.cardTitle)
    expectOnly(language, 'welcome')
    const target = screen.getByLabelText(t.form.targetLabel)
    await u.clear(target)
    await u.type(target, 'abc')
    await screen.findByText(t.form.errors.targetInvalid)
    const maximum = screen.getByLabelText(t.form.maxLabel)
    await u.clear(maximum)
    await u.type(maximum, '0')
    await screen.findByText(t.form.errors.maxTooLow)
    expectOnly(language, 'welcome with errors')
    await u.click(screen.getByRole('radio', { name: t.form.duration.months(12) }))
    expectOnly(language, 'welcome after choosing 12 months')
  })

  it.each(['sv', 'en'] as const)('%s: the recovery screens are fully translated', async (language) => {
    const { t } = createI18n(language)
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    const legacy = playedChallenge('audit-damaged')
    const damaged = setup()
    await seedV1Database(damaged.name, { activeRow: { id: 'active', seed: legacy.seed }, entries: withDay(legacy.days, 20, { amount: 0 }) })
    const u = user()
    const view = render(<App services={damaged.services} />)
    await screen.findByText(t.recovery.title)
    expectOnly(language, 'damaged data screen')
    await u.click(screen.getByRole('button', { name: t.recovery.continue }))
    await screen.findByRole('dialog')
    expectOnly(language, 'damaged data dialog')
    view.unmount()

    const broken = setup()
    await broken.repository.saveChallenge(createChallenge('audit-broken', sixMonths(), 'broken'), { name: 'Alfa' })
    await broken.repository.database.challengeEntries.update(['broken', '2026-12-01'], { amount: -5 })
    const second = render(<App services={broken.services} />)
    await screen.findByText(t.storageProblem.title)
    expectOnly(language, 'storage problem screen')
    second.unmount()

    const outdated = setup()
    await outdated.repository.saveChallenge(createChallenge('audit-outdated', sixMonths(), 'old'), { name: 'Alfa' })
    render(<App services={outdated.services} />)
    await screen.findByRole('button', { name: t.app.tabs.home })
    outdated.repository.database.on('versionchange').fire(new Event('versionchange'))
    await screen.findByText(t.outdated.title)
    expectOnly(language, 'reload screen')
    await waitFor(() => expect(screen.getByRole('button', { name: t.outdated.reload })).toBeTruthy())
  })
})
