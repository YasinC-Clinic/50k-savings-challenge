// @vitest-environment jsdom
/**
 * Shock Days, catch-up sessions, the penalty pot, the completion summary and the automatic range, tested through the
 * whole app with an isolated database and a controllable clock.
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createChallenge, dynamicBounds, type Challenge, type ChallengeConfig } from '../domain/challenge'
import { penaltyTotals, shockDates } from '../domain/ledger'
import { createI18n } from '../i18n/i18n'
import { LANGUAGE_STORAGE_KEY, type Language } from '../i18n/language'
import { SavingsDatabase, SavingsRepository } from '../persistence/savings-repository'
import { uniqueName } from '../persistence/testing/v1-fixtures'

configure({ asyncUtilTimeout: 5000 })

const databases: SavingsDatabase[] = []
const names: string[] = []
const norm = (value: string | null | undefined) => (value ?? '').replace(/[  ]/g, ' ')
const CONFIG: ChallengeConfig = { targetSek: 2_000, startDate: '2027-01-01', endDate: '2027-01-31', initialMinimumSek: 20, preferredMaximumSek: 120 }
const SHOCK_CONFIG: ChallengeConfig = { targetSek: 20_000, startDate: '2027-01-01', endDate: '2027-03-31', initialMinimumSek: 100, preferredMaximumSek: 500, shockDays: true }

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  databases.splice(0).forEach((database) => database.close())
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)))
  localStorage.clear()
})

function setup(nowIso: string) {
  const name = uniqueName('features')
  names.push(name)
  const database = new SavingsDatabase(name)
  databases.push(database)
  const repository = new SavingsRepository(database)
  return { repository, services: { repository, now: () => new Date(nowIso) } }
}

/** 2,000 SEK target, 200 SEK confirmed on day one, 1,800 SEK still missing. */
function exampleChallenge(): Challenge {
  const base = createChallenge('seed-features', CONFIG, 'c')
  return { ...base, days: base.days.map((day, index) => (index === 0 ? { ...day, amount: 200, status: 'confirmed' as const } : { ...day, amount: 60 })) }
}

/** The app opens on 5 January, so 2, 3 and 4 January are missed. The penalty clock started on 1 January. */
async function seedThreeMissedDays(repository: SavingsRepository) {
  await repository.saveChallenge(exampleChallenge(), { name: 'Alfa' })
  await repository.setActiveChallenge('c')
  await repository.accruePenalties('c', '2027-01-01')
}

const MISSED_NOW = '2027-01-05T12:00:00+01:00'
const user = () => userEvent.setup()
const goTo = async (u: ReturnType<typeof userEvent.setup>, label: string) => u.click(await screen.findByRole('button', { name: label }))
const balance = () => norm(document.querySelector('.balance-amount')?.textContent)
const summaryText = async () => norm((await screen.findByText('Sammanfattning', { selector: 'h2' })).closest('section')?.textContent)
const clickIn = async (u: ReturnType<typeof userEvent.setup>, container: HTMLElement, name: string) =>
  u.click(within(container).getByRole('button', { name }))

describe('penalty pot', () => {
  it('shows the 157.19 kr penalty next to, and never inside, the savings: 200 kr saved of 2 000 kr', async () => {
    const { services, repository } = setup(MISSED_NOW)
    await seedThreeMissedDays(repository)
    render(<App services={services} />)

    expect(await screen.findByRole('heading', { name: /Straffpott/ })).toBeTruthy()
    const pot = norm(document.querySelector('.pot-card')?.textContent)
    expect(pot).toContain('Upplupet157,19 kr')
    expect(pot).toContain('Betalt (bekräftat av dig)0,00 kr')
    expect(pot).toContain('Kvar att betala157,19 kr')
    expect(balance()).toBe('200 kr')
    expect(norm(document.body.textContent)).toContain('Mål 2 000 kr')
    expect((await repository.loadChallenge('c'))!.config.targetSek).toBe(2_000)
    expect((await repository.readLedger()).payments).toEqual([])
  })

  it('lists the pot per challenge and records a payment only after the person confirms it', async () => {
    const { services, repository } = setup(MISSED_NOW)
    await seedThreeMissedDays(repository)
    const u = user()
    render(<App services={services} />)
    await screen.findByRole('heading', { name: /Straffpott/ })

    await goTo(u, 'Utmaningar')
    expect(await screen.findByText('Per utmaning')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Bekräfta betalning' }))
    const dialog = await screen.findByRole('dialog')
    expect(norm(dialog.textContent)).toContain('157,19 kr')
    expect((await repository.readLedger()).payments).toEqual([])

    await clickIn(u, dialog, 'Avbryt')
    expect((await repository.readLedger()).payments).toEqual([])

    await u.click(screen.getByRole('button', { name: 'Bekräfta betalning' }))
    await clickIn(u, await screen.findByRole('dialog'), 'Ja, jag har betalat')
    await waitFor(async () => expect((await repository.readLedger()).payments).toHaveLength(1))
    const ledger = await repository.readLedger()
    expect(penaltyTotals(ledger.penalties, ledger.payments, 'c')).toEqual({ accruedOre: 15_719, paidOre: 15_719, outstandingOre: 0 })
    expect(await screen.findByText('Betalningen av straffavgiften är bekräftad.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Bekräfta betalning' })).toBeNull())

    await goTo(u, 'Idag')
    expect(balance()).toBe('200 kr')
  })

  it('adds up penalties of several challenges into one permanent pot', async () => {
    const { services, repository } = setup(MISSED_NOW)
    await seedThreeMissedDays(repository)
    const second = { ...exampleChallenge(), id: 'd', seed: 'seed-second' }
    await repository.saveChallenge(second, { name: 'Beta' })
    await repository.accruePenalties('d', MISSED_NOW)
    render(<App services={services} />)
    await screen.findByRole('heading', { name: /Straffpott/ })
    const u = user()
    await goTo(u, 'Utmaningar')
    const pot = norm((await screen.findByText('Per utmaning')).closest('.pot-card')?.textContent)
    expect(pot).toContain('Alfa')
    expect(pot).toContain('157,19 kr')
  })
})

describe('catch-up session', () => {
  it('catches up three missed days one at a time, survives pause and reload, and counts only confirmed days', async () => {
    const { services, repository } = setup(MISSED_NOW)
    await seedThreeMissedDays(repository)
    const u = user()
    const first = render(<App services={services} />)

    expect(await screen.findByText('3 missade dagar att ta igen')).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Ta igen missade dagar' }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Dag 1 av 3')).toBeTruthy()
    expect(within(dialog).getByText('Missad dag: 2 jan. 2027')).toBeTruthy()
    const firstAmount = norm(dialog.querySelector('.daily-amount')?.textContent)
    expect(balance()).toBe('200 kr')

    await clickIn(u, dialog, 'Pausa')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(balance()).toBe('200 kr')

    first.unmount()
    render(<App services={services} />)
    await u.click(await screen.findByRole('button', { name: 'Fortsätt ta igen' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Dag 1 av 3')).toBeTruthy()
    expect(norm(dialog.querySelector('.daily-amount')?.textContent)).toBe(firstAmount)

    await clickIn(u, dialog, 'Bekräfta sparandet')
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('Dag 2 av 3')).toBeTruthy())
    await clickIn(u, screen.getByRole('dialog'), 'Bekräfta sparandet')
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('Dag 3 av 3')).toBeTruthy())
    await clickIn(u, screen.getByRole('dialog'), 'Bekräfta sparandet')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const { catchUps } = await repository.readLedger()
    expect(catchUps.map((entry) => [entry.date, entry.status])).toEqual([['2027-01-02', 'confirmed'], ['2027-01-03', 'confirmed'], ['2027-01-04', 'confirmed']])
    const caughtUp = catchUps.reduce((total, entry) => total + entry.amount, 0)
    expect(balance()).toBe(norm(createI18n('sv').fmt.sek(200 + caughtUp)))
    expect(screen.queryByText(/missade dagar att ta igen/)).toBeNull()
    const challenge = (await repository.loadChallenge('c'))!
    expect(challenge.days.filter((day) => day.status === 'missed').map((day) => day.date)).toEqual(['2027-01-02', '2027-01-03', '2027-01-04'])
    const upcoming = challenge.days.filter((day) => day.date >= '2027-01-05')
    expect(upcoming.reduce((total, day) => total + day.amount, 0) + caughtUp + 200).toBe(2_000)
  })

  it('does not offer the same missed day again after a reload (each date exactly once)', async () => {
    const { services, repository } = setup(MISSED_NOW)
    await seedThreeMissedDays(repository)
    const u = user()
    const first = render(<App services={services} />)
    await u.click(await screen.findByRole('button', { name: 'Ta igen missade dagar' }))
    await clickIn(u, await screen.findByRole('dialog'), 'Bekräfta sparandet')
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('Dag 2 av 3')).toBeTruthy())
    first.unmount()

    render(<App services={services} />)
    expect(await screen.findByText('2 missade dagar att ta igen')).toBeTruthy()
    expect((await repository.readLedger()).penalties).toHaveLength(3)
  })
})

describe('Shock Days', () => {
  async function shockSetup(withEarlierMiss = false) {
    const base = createChallenge('shock-seed', SHOCK_CONFIG, 'sh')
    const shockDate = [...shockDates(base)].sort()[0]
    const challenge: Challenge = {
      ...base,
      days: base.days.map((day, index) => (day.date < shockDate && !(withEarlierMiss && index === 0) ? { ...day, status: 'confirmed' as const } : day)),
    }
    const { services, repository } = setup(`${shockDate}T12:00:00+01:00`)
    await repository.saveChallenge(challenge, { name: 'Blixt' })
    await repository.setActiveChallenge('sh')
    await repository.accruePenalties('sh', '2027-01-01')
    return { services, repository, shockDate, challenge }
  }

  it('offers an unusually high amount that is never stored until accepted, rerolls for free without repeating, and then needs the normal confirmation', async () => {
    const { services, repository, shockDate } = await shockSetup()
    const u = user()
    render(<App services={services} />)

    expect(await screen.findByRole('heading', { name: 'Chockdag!' })).toBeTruthy()
    const accept = screen.getByRole('button', { name: 'ACCEPTERA' })
    const again = screen.getByRole('button', { name: 'NEJ — DRA IGEN' })
    const savedBefore = balance()
    const amounts = [norm(document.querySelector('.shock-amount')?.textContent)]
    for (let round = 0; round < 6; round += 1) {
      await u.click(again)
      amounts.push(norm(document.querySelector('.shock-amount')?.textContent))
    }
    amounts.slice(1).forEach((amount, index) => expect(amount).not.toBe(amounts[index]))

    const stored = (await repository.loadChallenge('sh'))!
    expect(stored.days.find((day) => day.date === shockDate)).toMatchObject({ status: 'undrawn' })
    expect(balance()).toBe(savedBefore)

    await u.click(accept)
    expect(await screen.findByText('Chockbeloppet är draget. Det räknas som sparat först när du bekräftar.')).toBeTruthy()
    const drawn = (await repository.loadChallenge('sh'))!
    const today = drawn.days.find((day) => day.date === shockDate)!
    expect(today.status).toBe('drawn')
    expect(norm(createI18n('sv').fmt.sek(today.amount))).toBe(amounts.at(-1))
    expect(balance()).toBe(savedBefore)
    expect(drawn.days.filter((day) => day.status !== 'missed').reduce((total, day) => total + day.amount, 0)).toBe(20_000)

    await u.click(await screen.findByRole('button', { name: 'Jag har sparat beloppet' }))
    await clickIn(u, await screen.findByRole('dialog'), 'Ja, jag har sparat det')
    await screen.findByText('Sparat idag')
    expect((await repository.loadChallenge('sh'))!.days.find((day) => day.date === shockDate)!.status).toBe('confirmed')
    expect(balance()).not.toBe(savedBefore)
  })

  it('is not offered for a challenge that did not opt in', async () => {
    const base = createChallenge('shock-seed', { ...SHOCK_CONFIG, shockDays: undefined }, 'plain')
    const shockDate = [...shockDates(base)].sort()[0]
    const { services, repository } = setup(`${shockDate}T12:00:00+01:00`)
    await repository.saveChallenge({ ...base, days: base.days.map((day) => (day.date < shockDate ? { ...day, status: 'confirmed' as const } : day)) })
    render(<App services={services} />)
    expect(await screen.findByRole('button', { name: 'Dra dagens belopp' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Chockdag!' })).toBeNull()
  })

  it('never appears while a catch-up session is open or paused', async () => {
    const { services } = await shockSetup(true)
    const u = user()
    render(<App services={services} />)
    await u.click(await screen.findByRole('button', { name: 'Ta igen missade dagar' }))
    const dialog = await screen.findByRole('dialog')
    expect(screen.queryByRole('heading', { name: 'Chockdag!' })).toBeNull()
    await clickIn(u, dialog, 'Pausa')
    expect(screen.queryByRole('heading', { name: 'Chockdag!' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Fortsätt ta igen' })).toBeTruthy()
  })
})

describe('creating a challenge with an automatic range', () => {
  it('calculates the range from target and days, shows it, stores it, and keeps the total exact', async () => {
    const { services, repository } = setup('2026-11-08T11:00:00+01:00')
    const u = user()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    const { minimumSek, maximumSek } = dynamicBounds(50_000, 182)
    const { fmt } = createI18n('sv')
    expect(norm(document.querySelector('.challenge-form')?.textContent)).toContain(norm(`${fmt.sek(minimumSek)} – ${fmt.sek(maximumSek)} per dag`))
    expect(screen.queryByLabelText('Lägsta dagsbelopp (kr)')).toBeNull()

    await u.click(screen.getByRole('button', { name: 'Starta utmaningen' }))
    await screen.findByRole('button', { name: 'Dra dagens belopp' })
    const stored = (await repository.loadChallenge())!
    expect(stored.config).toEqual({ targetSek: 50_000, startDate: '2026-11-08', endDate: '2027-05-08', initialMinimumSek: minimumSek, preferredMaximumSek: maximumSek, dynamicRange: true })
    expect(stored.days.reduce((total, day) => total + day.amount, 0)).toBe(50_000)
    expect(stored.days.every((day) => day.amount >= minimumSek && day.amount <= maximumSek)).toBe(true)
  })

  it('accepts a low target that a fixed 50 kr minimum would have refused, and an optional Shock Day setting', async () => {
    const { services, repository } = setup('2026-11-08T11:00:00+01:00')
    const u = user()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    const target = screen.getByLabelText('Sparmål (kr)')
    await u.clear(target)
    await u.type(target, '1000')
    expect((screen.getByRole('button', { name: 'Starta utmaningen' }) as HTMLButtonElement).disabled).toBe(false)
    await u.click(screen.getByRole('checkbox', { name: /Chockdagar/ }))
    await u.click(screen.getByRole('button', { name: 'Starta utmaningen' }))
    await screen.findByRole('button', { name: 'Dra dagens belopp' })
    const stored = (await repository.loadChallenge())!
    expect(stored.config).toMatchObject({ targetSek: 1_000, dynamicRange: true, shockDays: true })
    expect(stored.days.reduce((total, day) => total + day.amount, 0)).toBe(1_000)
  })

  it('still lets the person choose their own limits (manual adjustment is preserved)', async () => {
    const { services, repository } = setup('2026-11-08T11:00:00+01:00')
    const u = user()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    await u.click(screen.getByRole('checkbox', { name: 'Beräkna dagsbelopp automatiskt' }))
    await u.click(screen.getByRole('button', { name: 'Starta utmaningen' }))
    await screen.findByRole('button', { name: 'Dra dagens belopp' })
    const stored = (await repository.loadChallenge())!
    expect(stored.config).toEqual({ targetSek: 50_000, startDate: '2026-11-08', endDate: '2027-05-08', initialMinimumSek: 50, preferredMaximumSek: 500 })
  })
})

describe('completion summary', () => {
  it('shows target, saved, missed days, penalties accrued/paid/outstanding and the pot, and keeps the target a target', async () => {
    const { services, repository } = setup('2027-02-05T12:00:00+01:00')
    await seedThreeMissedDays(repository)
    render(<App services={services} />)
    await summaryText()

    const ledger = await repository.readLedger()
    const own = penaltyTotals(ledger.penalties, ledger.payments, 'c')
    const { fmt } = createI18n('sv')
    const summary = await summaryText()
    expect(summary).toContain('Sparmål2 000 kr')
    expect(summary).toContain('Sparat (bekräftat)200 kr')
    expect(summary).toContain('Missade dagar30')
    expect(summary).toContain(norm(`Straffavgifter, upplupna${fmt.ore(own.accruedOre)}`))
    expect(summary).toContain(norm(`Straffavgifter, betalda${fmt.ore(0)}`))
    expect(summary).toContain(norm(`Straffavgifter, kvar att betala${fmt.ore(own.outstandingOre)}`))
    expect(summary).toContain('Samlad översikt (endast information)')
    expect(own.accruedOre).toBeGreaterThan(15_719)
    expect(balance()).toBe('200 kr')
    expect((await repository.loadChallenge('c'))!.config.targetSek).toBe(2_000)
  })

  it('charges no further penalties after the target was reached', async () => {
    const { services, repository } = setup('2027-02-05T12:00:00+01:00')
    const done: Challenge = {
      ...createChallenge('done', { ...CONFIG, targetSek: 100, endDate: '2027-01-02', initialMinimumSek: 10, preferredMaximumSek: 100 }, 'c'),
      days: [{ date: '2027-01-01', amount: 100, status: 'confirmed' }, { date: '2027-01-02', amount: 20, status: 'missed' }],
    }
    await repository.saveChallenge(done, { name: 'Klar' })
    await repository.setActiveChallenge('c')
    render(<App services={services} />)
    await summaryText()
    expect((await repository.readLedger()).penalties).toEqual([])
    expect(await summaryText()).toContain('Straffavgifter, upplupna0,00 kr')
  })
})

// ---------------------------------------------------------------------------------------------
// Every new screen is translated: no English in Swedish and no Swedish in English
// ---------------------------------------------------------------------------------------------

const SWEDISH_IN_ENGLISH = /[åäöÅÄÖ]|\b(och|att|det|som|är|inte|för|med|din|dina|ditt|dagar|utmaning|utmaningar|spara|sparat|belopp|nyår|månad|idag)\b/giu
const ENGLISH_IN_SWEDISH =
  /\b(the|and|your|you|with|this|that|are|not|have|from|will|Cancel|Save|Settings|Calendar|Challenges?|Today|Confirm|Confirmed|Missed|Import|Imported|Export|Backup|Saved|Draw|Drawn)\b/gu

function expectOnly(language: Language, where: string) {
  const text = norm(document.body.textContent)
  const found = (text.match(language === 'en' ? SWEDISH_IN_ENGLISH : ENGLISH_IN_SWEDISH) ?? []).map((word) => word.toLowerCase())
  expect({ where, language, found: [...new Set(found)] }).toEqual({ where, language, found: [] })
}

describe.each(['sv', 'en'] as const)('new features in %s', (language) => {
  const { t } = createI18n(language)

  it('translates the penalty pot, the catch-up dialog and the summary', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    const { services, repository } = setup('2027-01-05T12:00:00+01:00')
    await seedThreeMissedDays(repository)
    const u = user()
    render(<App services={services} />)
    await screen.findByRole('heading', { name: new RegExp(t.ledger.penalty.potTitle) })
    expectOnly(language, 'home with pot and catch-up banner')

    await u.click(screen.getByRole('button', { name: t.ledger.catchUp.start }))
    await screen.findByRole('dialog')
    expectOnly(language, 'catch-up dialog')
    await clickIn(u, screen.getByRole('dialog'), t.ledger.catchUp.pause)

    await goTo(u, t.app.tabs.challenges)
    await screen.findByText(t.ledger.penalty.perChallenge)
    expectOnly(language, 'detailed pot')
    await u.click(screen.getByRole('button', { name: t.ledger.penalty.markPaid }))
    await screen.findByRole('dialog')
    expectOnly(language, 'confirm payment dialog')
  })

  it('translates the Shock Day card and the automatic range form', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    const base = createChallenge('shock-seed', SHOCK_CONFIG, 'sh')
    const shockDate = [...shockDates(base)].sort()[0]
    const { services, repository } = setup(`${shockDate}T12:00:00+01:00`)
    await repository.saveChallenge({ ...base, days: base.days.map((day) => (day.date < shockDate ? { ...day, status: 'confirmed' as const } : day)) })
    await repository.setActiveChallenge('sh')
    render(<App services={services} />)
    await screen.findByRole('heading', { name: t.ledger.shock.title })
    expect(screen.getByRole('button', { name: t.ledger.shock.accept })).toBeTruthy()
    expect(screen.getByRole('button', { name: t.ledger.shock.drawAgain })).toBeTruthy()
    expectOnly(language, 'shock day card')
  })

  it('translates the automatic range on the welcome screen', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    const { services } = setup('2026-11-08T11:00:00+01:00')
    render(<App services={services} />)
    await screen.findByText(t.onboarding.cardTitle)
    expect(screen.getByRole('checkbox', { name: t.form.autoLabel })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: new RegExp(t.form.shockLabel.slice(0, 6)) })).toBeTruthy()
    expectOnly(language, 'welcome with automatic range')
  })
})
