// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { DEFAULT_CHALLENGE_CONFIG, confirmDay, createChallenge, drawToday, type ChallengeConfig } from '../domain/challenge'
import { SavingsDatabase, SavingsRepository } from '../persistence/savings-repository'
import { playedChallenge, seedV1Database, snapshotLegacyTables, uniqueName, v1BackupJson, withDay } from '../persistence/testing/v1-fixtures'
import { createI18n } from '../i18n/i18n'

configure({ asyncUtilTimeout: 5000 })

const databases: SavingsDatabase[] = []
const names: string[] = []
const norm = (value: string | null | undefined) => (value ?? '').replace(/[  ]/g, ' ')
const sek = createI18n('sv').fmt.sek
const startedToday: ChallengeConfig = { targetSek: 50_000, startDate: '2026-11-08', endDate: '2027-06-30', initialMinimumSek: 50, preferredMaximumSek: 500 }

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  databases.splice(0).forEach((database) => database.close())
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)))
  Reflect.deleteProperty(navigator, 'storage')
  // The chosen language is stored on the device; every test starts like a new installation (Swedish).
  localStorage.clear()
})

/** An isolated database and a clock the test can move. 2026-11-08 11:00 in Stockholm unless told otherwise. */
function setup(nowIso = '2026-11-08T11:00:00+01:00', name = uniqueName('ui')) {
  names.push(name)
  const database = new SavingsDatabase(name)
  databases.push(database)
  const repository = new SavingsRepository(database)
  const clock = { current: new Date(nowIso) }
  return { name, repository, clock, services: { repository, now: () => clock.current } }
}

function captureDownloads(): Blob[] {
  const blobs: Blob[] = []
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (blob: Blob) => (blobs.push(blob), 'blob:test') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  return blobs
}

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

function jsonFile(text: string, name = 'backup.json'): File {
  const file = new File([text], name, { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: async () => text })
  return file
}

const balance = () => norm(document.querySelector('.balance-amount')?.textContent)
const goTo = async (user: ReturnType<typeof userEvent.setup>, tab: string) =>
  user.click(await screen.findByRole('button', { name: tab }))

async function startFirstChallenge(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('Skapa din första utmaning')
  await user.click(screen.getByRole('button', { name: 'Starta utmaningen' }))
  return screen.findByRole('button', { name: 'Dra dagens belopp' })
}

describe('creating a challenge and the daily draw', () => {
  it('starts today, hides the amount until drawn, and counts it only after confirmation', async () => {
    const { services, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    const drawButton = await startFirstChallenge(user)

    const created = (await repository.loadChallenge())!
    // The default duration is six months: 8 Nov 2026 to 8 May 2027, 182 calendar days.
    expect(created.config).toMatchObject({ targetSek: 50_000, startDate: '2026-11-08', endDate: '2027-05-08' })
    expect(created.days).toHaveLength(182)
    expect(created.days.every((day) => day.status === 'undrawn')).toBe(true)
    expect(balance()).toBe('0 kr')
    expect(norm(document.body.textContent)).toContain('DAG 1 AV 182')

    await user.click(drawButton)
    await screen.findByText('Idag – inte bekräftat än')
    const amount = (await repository.loadChallenge())!.days[0].amount
    expect(norm(document.querySelector('.daily-amount')?.textContent)).toBe(norm(sek(amount)))
    expect(balance()).toBe('0 kr')
    expect(norm(document.body.textContent)).toContain('Draget men ännu inte bekräftat')

    await user.click(screen.getByRole('button', { name: 'Jag har sparat beloppet' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Ja, jag har sparat det' }))
    await screen.findByText('Sparat idag')

    expect(balance()).toBe(norm(sek(amount)))
    expect((await repository.loadChallenge())!.days[0]).toMatchObject({ status: 'confirmed', amount })
    expect(screen.queryByRole('button', { name: 'Dra dagens belopp' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Jag har sparat beloppet' })).toBeNull()
  })

  it('keeps the amount unconfirmed when the confirmation dialog is cancelled', async () => {
    const { services, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await user.click(await startFirstChallenge(user))
    await user.click(await screen.findByRole('button', { name: 'Jag har sparat beloppet' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Avbryt' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(balance()).toBe('0 kr')
    expect((await repository.loadChallenge())!.days[0].status).toBe('drawn')
  })

  it('never lets a confirmed amount be changed afterwards, even by a direct save', async () => {
    const { services, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await user.click(await startFirstChallenge(user))
    await user.click(await screen.findByRole('button', { name: 'Jag har sparat beloppet' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Ja, jag har sparat det' }))
    await screen.findByText('Sparat idag')

    const stored = (await repository.loadChallenge())!
    const tampered = { ...stored, days: stored.days.map((day, index) => (index === 0 ? { ...day, status: 'drawn' as const } : day)) }
    await expect(repository.saveChallenge(tampered)).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
  })

  it('shows that the first draw has not opened yet for a challenge that starts in the future', async () => {
    // New challenges always start today, but the original 2027 challenge (and imports) start later.
    const { services, repository } = setup()
    await repository.saveChallenge(createChallenge('future', DEFAULT_CHALLENGE_CONFIG, 'future'), { name: 'Våren 2027' })
    render(<App services={services} />)

    await screen.findByText('Din första dragning väntar')
    expect(screen.queryByRole('button', { name: 'Dra dagens belopp' })).toBeNull()
    const stored = (await repository.loadChallenge())!
    expect(stored.config).toEqual(DEFAULT_CHALLENGE_CONFIG)
    expect(stored.days).toHaveLength(181)
    expect(norm(document.body.textContent)).toContain('181 dagar kvar')
  })

  it('explains validation problems in Swedish and creates nothing', async () => {
    const { services, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')

    const target = screen.getByLabelText('Sparmål (kr)')
    await user.clear(target)
    await user.type(target, '1000')
    expect(await screen.findByText(/Målet är för lågt för 6 månader \(182 dagar\)/)).toBeTruthy()
    const submit = screen.getByRole('button', { name: 'Starta utmaningen' })
    expect(submit).toHaveProperty('disabled', true)

    await user.clear(target)
    await user.type(target, 'abc')
    expect(await screen.findByText(/Ange målet i hela kronor/)).toBeTruthy()
    expect(submit).toHaveProperty('disabled', true)
    await user.click(submit)
    expect(await repository.listChallenges()).toEqual([])
  })

  it('shows the six-month default, a live summary, and no manual date fields', async () => {
    const { services } = setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')

    expect(screen.getByText('Hur länge vill du spara?', { selector: 'legend' })).toBeTruthy()
    const radios = screen.getAllByRole('radio')
    expect(radios.map((radio) => radio.textContent)).toEqual(['1 månad', '2 månader', '3 månader', '4 månader', '5 månader', '6 månader', '9 månader', '12 månader', 'Till nyår'])
    expect(radios.filter((radio) => radio.getAttribute('aria-checked') === 'true').map((radio) => radio.textContent)).toEqual(['6 månader'])
    expect(screen.queryByLabelText('Startdatum')).toBeNull()
    expect(screen.queryByLabelText('Slutdatum')).toBeNull()

    const summary = norm(screen.getByLabelText('Sammanfattning av utmaningen').textContent)
    expect(summary).toContain('Startdatum8 nov. 2026 (idag)')
    expect(summary).toContain('Slutdatum8 maj 2027')
    expect(summary).toContain('Antal spardagar182 dagar')
    expect(summary).toContain('Sparmål50 000 kr')
    expect(summary).toContain('Dagsbelopp50 kr – 500 kr')
    expect((screen.getByLabelText('Lägsta dagsbelopp (kr)') as HTMLInputElement).value).toBe('50')
    expect((screen.getByLabelText('Högsta dagsbelopp (kr)') as HTMLInputElement).value).toBe('500')
  })

  it('shows every field of the creation form in the requested order', async () => {
    const { services } = setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    const labels = Array.from(document.querySelectorAll('.challenge-form label, .challenge-form legend')).map((node) => norm(node.textContent))
    expect(labels).toEqual(['Namn (valfritt)', 'Sparmål (kr)', 'Hur länge vill du spara?', 'Lägsta dagsbelopp (kr)', 'Högsta dagsbelopp (kr)'])
    expect(norm(screen.getByLabelText('Sammanfattning av utmaningen').textContent)).toMatch(/Startdatum.*Slutdatum.*Antal spardagar.*Sparmål.*Dagsbelopp/)
  })

  it('creates a "Till nyår" challenge ending on 31 December with the exact number of days and the chosen limits', async () => {
    const { services, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    await user.click(screen.getByRole('radio', { name: 'Till nyår' }))
    for (const [label, value] of [['Lägsta dagsbelopp (kr)', '100'], ['Högsta dagsbelopp (kr)', '1500']] as const) {
      const field = screen.getByLabelText(label)
      await user.clear(field)
      await user.type(field, value)
    }
    const summary = norm(screen.getByLabelText('Sammanfattning av utmaningen').textContent)
    expect(summary).toContain('Startdatum8 nov. 2026 (idag)')
    expect(summary).toContain('Slutdatum31 dec. 2026')
    expect(summary).toContain('Antal spardagar54 dagar')
    expect(summary).toContain('Dagsbelopp100 kr – 1 500 kr')

    await user.click(screen.getByRole('button', { name: 'Starta utmaningen' }))
    await screen.findByRole('button', { name: 'Dra dagens belopp' })
    const stored = (await repository.loadChallenge())!
    expect(stored.config).toEqual({ targetSek: 50_000, startDate: '2026-11-08', endDate: '2026-12-31', initialMinimumSek: 100, preferredMaximumSek: 1_500 })
    expect(stored.days).toHaveLength(54)
    expect(stored.days.reduce((total, day) => total + day.amount, 0)).toBe(50_000)
    expect(stored.days.every((day) => day.amount >= 100 && day.amount <= 1_500)).toBe(true)
    expect(norm(document.body.textContent)).toContain('DAG 1 AV 54')
  })

  it('explains that 50,000 kr does not fit "Till nyår" at the default limits and blocks creation', async () => {
    const { services, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    await user.click(screen.getByRole('radio', { name: 'Till nyår' }))
    expect(await screen.findByText(/Målet är för högt för Till nyår \(54 dagar\)\. Högst 27.000/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Starta utmaningen' })).toHaveProperty('disabled', true)
    expect(await repository.listChallenges()).toEqual([])
  })

  it('stores custom daily limits per challenge and keeps every amount inside them', async () => {
    const { services, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    await user.click(screen.getByRole('radio', { name: '1 månad' }))
    for (const [label, value] of [['Sparmål (kr)', '8000'], ['Lägsta dagsbelopp (kr)', '200'], ['Högsta dagsbelopp (kr)', '300']] as const) {
      const field = screen.getByLabelText(label)
      await user.clear(field)
      await user.type(field, value)
    }
    expect(norm(screen.getByLabelText('Sammanfattning av utmaningen').textContent)).toContain('Dagsbelopp200 kr – 300 kr')
    await user.click(screen.getByRole('button', { name: 'Starta utmaningen' }))
    await screen.findByRole('button', { name: 'Dra dagens belopp' })

    const stored = (await repository.loadChallenge())!
    expect(stored.config).toMatchObject({ targetSek: 8_000, initialMinimumSek: 200, preferredMaximumSek: 300 })
    expect(stored.days).toHaveLength(31)
    expect(stored.days.reduce((total, day) => total + day.amount, 0)).toBe(8_000)
    expect(stored.days.every((day) => Number.isInteger(day.amount) && day.amount >= 200 && day.amount <= 300)).toBe(true)
  })

  it.each([
    ['a minimum above the maximum', '600', '500', /Lägsta dagsbelopp kan inte vara högre än högsta dagsbelopp/],
    ['a zero minimum', '0', '500', /Lägsta dagsbelopp måste vara minst 1 kr/],
    ['a fractional minimum', '50.5', '500', /Ange lägsta dagsbelopp i hela kronor/],
    ['a text maximum', '50', 'abc', /Ange högsta dagsbelopp i hela kronor/],
    ['a maximum above the supported limit', '50', '100001', /Högsta dagsbelopp kan vara högst 100.000/],
  ])('rejects %s with a Swedish message and creates nothing', async (_label, minimum, maximum, message) => {
    const { services, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    for (const [label, value] of [['Lägsta dagsbelopp (kr)', minimum], ['Högsta dagsbelopp (kr)', maximum]] as const) {
      const field = screen.getByLabelText(label)
      await user.clear(field)
      await user.type(field, value)
    }
    expect(await screen.findByText(message)).toBeTruthy()
    const submit = screen.getByRole('button', { name: 'Starta utmaningen' })
    expect(submit).toHaveProperty('disabled', true)
    await user.click(submit)
    expect(await repository.listChallenges()).toEqual([])
  })

  it('lets different challenges use different limits without touching an existing challenge', async () => {
    const { services, repository } = setup()
    const existing = createChallenge('custom-existing', { targetSek: 31 * 100, startDate: '2027-01-01', endDate: '2027-01-31', initialMinimumSek: 80, preferredMaximumSek: 120 }, 'existing')
    await repository.saveChallenge(existing, { name: 'Gamla' })
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Gamla')

    await goTo(user, 'Utmaningar')
    await user.click(await screen.findByRole('button', { name: /Ny utmaning/ }))
    await user.click(screen.getByRole('radio', { name: '1 månad' }))
    for (const [label, value] of [['Sparmål (kr)', '8000'], ['Lägsta dagsbelopp (kr)', '200'], ['Högsta dagsbelopp (kr)', '300']] as const) {
      const field = screen.getByLabelText(label)
      await user.clear(field)
      await user.type(field, value)
    }
    await user.click(screen.getByRole('button', { name: 'Skapa utmaning' }))
    await user.click(await screen.findByRole('button', { name: 'Dra dagens belopp' }))
    await user.click(await screen.findByRole('button', { name: 'Jag har sparat beloppet' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Ja, jag har sparat det' }))
    await screen.findByText('Sparat idag')

    const created = (await repository.listChallenges()).find((challenge) => challenge.id !== 'existing')!
    expect(created.config).toMatchObject({ initialMinimumSek: 200, preferredMaximumSek: 300, targetSek: 8_000 })
    expect(created.days.every((day) => day.amount >= 200 && day.amount <= 300)).toBe(true)
    expect(created.days[0].status).toBe('confirmed')
    // The existing challenge keeps its own limits, its amounts and its dates, byte for byte.
    expect(await repository.loadChallenge('existing')).toEqual(existing)
    expect(existing.config).toMatchObject({ initialMinimumSek: 80, preferredMaximumSek: 120 })
  })

  it('says clearly that the app is not connected to a bank and never moves money', async () => {
    const automatic = /överförs automatiskt|dras automatiskt|automatisk överföring|automatiskt från ditt konto/i
    const { services } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    const welcome = norm(document.body.textContent)
    expect(welcome).toContain('Appen är inte kopplad till någon bank och flyttar aldrig pengar')
    expect(welcome).not.toMatch(automatic)

    await user.click(screen.getByRole('button', { name: 'Starta utmaningen' }))
    await screen.findByRole('button', { name: 'Dra dagens belopp' })
    expect(norm(document.querySelector('.daily-card')?.textContent)).toContain('Appen är inte kopplad till någon bank – du för själv över pengarna')

    await user.click(screen.getByRole('button', { name: 'Dra dagens belopp' }))
    await screen.findByText('Idag – inte bekräftat än')
    expect(norm(document.querySelector('.daily-card')?.textContent)).toContain('För över det själv via din bank – appen flyttar inga pengar')

    await user.click(screen.getByRole('button', { name: 'Jag har sparat beloppet' }))
    const dialog = norm((await screen.findByRole('dialog')).textContent)
    expect(dialog).toContain('Har du själv fört över')
    expect(dialog).toContain('Appen är inte kopplad till någon bank och har inte flyttat några pengar')
    expect(norm(document.body.textContent)).not.toMatch(automatic)

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Avbryt' }))
    await goTo(user, 'Inställningar')
    expect(norm(document.body.textContent)).toContain('Appen är inte kopplad till någon bank. Den flyttar eller drar aldrig pengar')
  })

  it('updates the summary live when another duration or target is chosen', async () => {
    const { services } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')

    await user.click(screen.getByRole('radio', { name: '12 månader' }))
    let summary = norm(screen.getByLabelText('Sammanfattning av utmaningen').textContent)
    expect(summary).toContain('Slutdatum8 nov. 2027')
    expect(summary).toContain('Antal spardagar366 dagar')
    expect(screen.getByRole('radio', { name: '12 månader' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: '6 månader' }).getAttribute('aria-checked')).toBe('false')

    const target = screen.getByLabelText('Sparmål (kr)')
    await user.clear(target)
    await user.type(target, '120000')
    summary = norm(screen.getByLabelText('Sammanfattning av utmaningen').textContent)
    expect(summary).toContain('Sparmål120 000 kr')
  })

  it('explains that 50,000 kr does not fit 1-3 months, blocks creation, and allows 4 months', async () => {
    const { services, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    const submit = screen.getByRole('button', { name: 'Starta utmaningen' })

    await user.click(screen.getByRole('radio', { name: '3 månader' }))
    expect(await screen.findByText(/Målet är för högt för 3 månader \(93 dagar\)\. Högst 46.500/)).toBeTruthy()
    expect(submit).toHaveProperty('disabled', true)
    expect(await repository.listChallenges()).toEqual([])

    await user.click(screen.getByRole('radio', { name: '4 månader' }))
    await waitFor(() => expect(submit).toHaveProperty('disabled', false))
    expect(screen.queryByText(/Målet är för högt/)).toBeNull()
  })

  it.each([
    [1, 5_000, '2026-12-08', 31],
    [2, 10_000, '2027-01-08', 62],
    [3, 20_000, '2027-02-08', 93],
    [4, 30_000, '2027-03-08', 121],
    [5, 40_000, '2027-04-08', 152],
    [6, 50_000, '2027-05-08', 182],
    [9, 60_000, '2027-08-08', 274],
    [12, 80_000, '2027-11-08', 366],
  ])('creates a %i-month challenge with the exact calculated dates and target allocation', async (months, targetSek, endDate, days) => {
    const { services, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    await user.click(screen.getByRole('radio', { name: months === 1 ? '1 månad' : `${months} månader` }))
    const target = screen.getByLabelText('Sparmål (kr)')
    await user.clear(target)
    await user.type(target, String(targetSek))
    await user.click(screen.getByRole('button', { name: 'Starta utmaningen' }))
    await screen.findByRole('button', { name: 'Dra dagens belopp' })

    const stored = (await repository.loadChallenge())!
    expect(stored.config).toEqual({ targetSek, startDate: '2026-11-08', endDate, initialMinimumSek: 50, preferredMaximumSek: 500 })
    expect(stored.days).toHaveLength(days)
    expect(stored.days.reduce((total, day) => total + day.amount, 0)).toBe(targetSek)
    expect(norm(document.body.textContent)).toContain(`DAG 1 AV ${days}`)
  })

  it('starts on the Stockholm date, which is already tomorrow just after midnight there', async () => {
    const { services, repository } = setup('2026-11-08T23:30:00Z')
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    expect(norm(screen.getByLabelText('Sammanfattning av utmaningen').textContent)).toContain('Startdatum9 nov. 2026 (idag)')
    await user.click(screen.getByRole('button', { name: 'Starta utmaningen' }))
    await screen.findByRole('button', { name: 'Dra dagens belopp' })
    expect((await repository.loadChallenge())!.config).toMatchObject({ startDate: '2026-11-09', endDate: '2027-05-09' })
  })

  it('handles a month-end start in the UI: 31 January + 1 month ends on 28 February', async () => {
    const { services, repository } = setup('2027-01-31T12:00:00+01:00')
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Skapa din första utmaning')
    await user.click(screen.getByRole('radio', { name: '1 månad' }))
    const target = screen.getByLabelText('Sparmål (kr)')
    await user.clear(target)
    await user.type(target, '8000')
    expect(norm(screen.getByLabelText('Sammanfattning av utmaningen').textContent)).toContain('Slutdatum28 feb. 2027')
    await user.click(screen.getByRole('button', { name: 'Starta utmaningen' }))
    await screen.findByRole('button', { name: 'Dra dagens belopp' })
    const stored = (await repository.loadChallenge())!
    expect(stored.config).toMatchObject({ startDate: '2027-01-31', endDate: '2027-02-28' })
    expect(stored.days).toHaveLength(29)
  })

  it('leaves existing challenges untouched when a new one is created, and keeps their original dates', async () => {
    const { services, repository } = setup()
    const original = confirmDay(drawToday(createChallenge('original', DEFAULT_CHALLENGE_CONFIG, 'original'), '2027-01-01'), '2027-01-01')
    await repository.saveChallenge(original, { name: 'Min första' })
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Min första')

    await goTo(user, 'Utmaningar')
    await user.click(await screen.findByRole('button', { name: /Ny utmaning/ }))
    await user.click(screen.getByRole('button', { name: 'Skapa utmaning' }))
    await screen.findByRole('button', { name: 'Dra dagens belopp' })

    expect(await repository.loadChallenge('original')).toEqual(original)
    const created = (await repository.listChallenges()).find((challenge) => challenge.id !== 'original')!
    expect(created.config.endDate).toBe('2027-05-08')

    await goTo(user, 'Utmaningar')
    const cards = (await screen.findAllByRole('listitem')).map((card) => norm(card.textContent))
    expect(cards.find((card) => card.includes('Min första'))).toContain('1 jan. 2027 – 30 juni 2027 · 181 dagar')
    expect(cards.find((card) => card.includes('Utmaning 2'))).toContain('8 nov. 2026 – 8 maj 2027 · 182 dagar')
  })

  it('exports a duration-based challenge and restores it unchanged, next to older backups', async () => {
    const blobs = captureDownloads()
    const { services, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await startFirstChallenge(user)
    const created = (await repository.loadChallenge())!

    await goTo(user, 'Inställningar')
    await user.click(await screen.findByRole('button', { name: 'Exportera säkerhetskopia' }))
    await waitFor(() => expect(blobs).toHaveLength(1))
    const backup = await blobText(blobs[0])
    expect(JSON.parse(backup).challenges[0].config).toEqual(created.config)

    const target = setup()
    await target.repository.restoreBackup(backup, { mode: 'replace', confirmReplace: true })
    expect(await target.repository.loadChallenge(created.id)).toEqual(created)
    await target.repository.restoreBackup(v1BackupJson(playedChallenge('older-file')), { mode: 'import-as-new' })
    expect(await target.repository.listChallenges()).toHaveLength(2)
  })
})

describe('several challenges', () => {
  it('keeps overlapping challenges separate and switches between them without mixing totals', async () => {
    const { services, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await user.click(await startFirstChallenge(user))
    await user.click(await screen.findByRole('button', { name: 'Jag har sparat beloppet' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Ja, jag har sparat det' }))
    await screen.findByText('Sparat idag')
    const firstSaved = balance()
    expect(firstSaved).not.toBe('0 kr')

    await goTo(user, 'Utmaningar')
    await user.click(await screen.findByRole('button', { name: /Ny utmaning/ }))
    await user.click(screen.getByRole('button', { name: 'Skapa utmaning' }))
    await screen.findByRole('button', { name: 'Dra dagens belopp' })
    expect(balance()).toBe('0 kr')

    const [first, second] = (await repository.listChallengeSummaries()).map((summary) => summary.id)
    const firstChallenge = (await repository.loadChallenge(first))!
    const secondChallenge = (await repository.loadChallenge(second))!
    expect(firstChallenge.config).toEqual(secondChallenge.config)
    expect(firstChallenge.days[0].status).toBe('confirmed')
    expect(secondChallenge.days.every((day) => day.status === 'undrawn')).toBe(true)

    await goTo(user, 'Utmaningar')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getAllByText('Aktiv', { selector: '.badge' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Gör aktiv' }))
    await screen.findByText('Bekräftat sparat')
    expect(balance()).toBe(firstSaved)
    expect(await repository.activeChallengeId()).toBe(first)
  })

  it('shows finished challenges as history and keeps their savings', async () => {
    const { services, repository } = setup('2027-07-05T10:00:00+02:00')
    const old = createChallenge('old', DEFAULT_CHALLENGE_CONFIG, 'old')
    const done = { ...old, days: old.days.map((day) => ({ ...day, status: 'confirmed' as const })) }
    await repository.saveChallenge(done, { name: 'Vårens sparande' })
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Vårens sparande')
    expect(norm(document.body.textContent)).toContain('Målet är nått')

    await goTo(user, 'Utmaningar')
    expect(await screen.findByText('Avslutade (historik)')).toBeTruthy()
    expect(norm(document.body.textContent)).toContain('50 000 kr sparat av 50 000 kr')
  })

  it('renames a challenge', async () => {
    const { services, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await startFirstChallenge(user)
    await goTo(user, 'Utmaningar')
    await user.click(await screen.findByRole('button', { name: 'Byt namn' }))
    const input = screen.getByLabelText('Nytt namn')
    await user.clear(input)
    await user.type(input, 'Resekassan')
    await user.click(screen.getByRole('button', { name: 'Spara' }))
    expect(await screen.findByText('Resekassan')).toBeTruthy()
    expect((await repository.listChallengeSummaries())[0].name).toBe('Resekassan')
  })

  it('shows the calendar with weekdays, Swedish months and only revealed amounts', async () => {
    const { services } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await user.click(await startFirstChallenge(user))
    await user.click(await screen.findByRole('button', { name: 'Jag har sparat beloppet' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Ja, jag har sparat det' }))
    await screen.findByText('Sparat idag')

    await goTo(user, 'Kalender')
    expect(await screen.findByText('november 2026')).toBeTruthy()
    expect(screen.getByText('maj 2027')).toBeTruthy()
    expect(screen.queryByText('juni 2027')).toBeNull()
    expect(document.querySelectorAll('.day.confirmed')).toHaveLength(1)
    expect(document.querySelector('.day.today')).toBeTruthy()
    const undrawn = Array.from(document.querySelectorAll('.day.undrawn b'))
    expect(undrawn).toHaveLength(181)
    expect(undrawn.every((cell) => cell.textContent === '–')).toBe(true)
  })
})

describe('dates, midnight and recovery', () => {
  it('moves to the next day when the app becomes active again and recovers the missed day', async () => {
    const { services, clock, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    await user.click(await startFirstChallenge(user))
    await screen.findByText('Idag – inte bekräftat än')

    clock.current = new Date('2026-11-09T09:00:00+01:00')
    fireEvent.focus(window)

    expect(await screen.findByText('Planen har räknats om')).toBeTruthy()
    await screen.findByText('Dagens belopp väntar')
    expect(norm(document.body.textContent)).toContain('DAG 2 AV 182')
    expect(norm(document.querySelector('.balance-stats')?.textContent)).toContain('1 missad')
    const stored = (await repository.loadChallenge())!
    expect(stored.days[0].status).toBe('missed')
    expect(stored.days[1].status).toBe('undrawn')
  })

  it('refuses to draw on a stale date after the app was in the background overnight', async () => {
    const { services, clock, repository } = setup()
    const user = userEvent.setup()
    render(<App services={services} />)
    const drawButton = await startFirstChallenge(user)

    clock.current = new Date('2026-11-10T08:00:00+01:00')
    await user.click(drawButton)

    expect(await screen.findByText(/Datumet har ändrats/)).toBeTruthy()
    const stored = (await repository.loadChallenge())!
    expect(stored.days.some((day) => day.status === 'drawn')).toBe(false)
  })

  it('uses the Stockholm date, not UTC, around midnight and daylight saving', async () => {
    const { services, clock, repository } = setup('2027-03-27T22:30:00Z')
    const config: ChallengeConfig = { ...startedToday, startDate: '2027-03-20', endDate: '2027-11-30' }
    await repository.saveChallenge(createChallenge('dst', config, 'dst'), { name: 'Sommartid' })
    render(<App services={services} />)
    await screen.findByText('Sommartid')
    expect(norm(document.body.textContent)).toContain('lördag 27 mars')

    clock.current = new Date('2027-03-27T23:00:00Z')
    fireEvent.focus(window)
    await waitFor(() => expect(norm(document.body.textContent)).toContain('söndag 28 mars'))
  })

  it('explains clearly when recovery needs a higher daily amount than the preferred maximum', async () => {
    const { services, repository } = setup('2027-06-28T10:00:00+02:00')
    await repository.saveChallenge(createChallenge('late', DEFAULT_CHALLENGE_CONFIG, 'late'), { name: 'Sen start' })
    render(<App services={services} />)
    expect(await screen.findByText('Planen har räknats om')).toBeTruthy()
    expect(await screen.findByText('Högre dagsbelopp krävs')).toBeTruthy()
    expect(norm(document.body.textContent)).toMatch(/upp till 16 667 kr per dag/)
    expect((await repository.loadChallenge('late'))!.config.endDate).toBe('2027-06-30')
  })

  it('says the target can no longer be reached after the deadline and never moves the end date', async () => {
    const { services, repository } = setup('2027-07-01T10:00:00+02:00')
    await repository.saveChallenge(createChallenge('over', DEFAULT_CHALLENGE_CONFIG, 'over'), { name: 'För sent' })
    render(<App services={services} />)
    expect(await screen.findByText('Målet kan inte längre nås')).toBeTruthy()
    expect(norm(document.body.textContent)).toContain('Slutdatumet flyttas inte automatiskt')
    expect(await screen.findByText('Tiden har gått ut')).toBeTruthy()
    expect((await repository.loadChallenge('over'))!.config.endDate).toBe('2027-06-30')
  })
})

describe('backup and restore', () => {
  async function openSettings(user: ReturnType<typeof userEvent.setup>) {
    await goTo(user, 'Inställningar')
    return screen.findByLabelText('Välj säkerhetskopia')
  }

  it('exports a backup file with every challenge', async () => {
    const blobs = captureDownloads()
    const { services, repository } = setup()
    await repository.saveChallenge(createChallenge('a', DEFAULT_CHALLENGE_CONFIG, 'a'), { name: 'A' })
    await repository.saveChallenge(createChallenge('b', startedToday, 'b'), { name: 'B' })
    const user = userEvent.setup()
    render(<App services={services} />)
    await openSettings(user)
    await user.click(screen.getByRole('button', { name: 'Exportera säkerhetskopia' }))

    await waitFor(() => expect(blobs).toHaveLength(1))
    const backup = JSON.parse(await blobText(blobs[0])) as { version: number; challenges: Array<{ id: string; name: string }> }
    expect(backup.version).toBe(2)
    expect(backup.challenges.map((challenge) => challenge.name).sort()).toEqual(['A', 'B'])
  })

  it('imports an old v1 backup as a NEW challenge and leaves everything else alone', async () => {
    const { services, repository } = setup()
    const existing = createChallenge('existing', DEFAULT_CHALLENGE_CONFIG, 'existing-id')
    await repository.saveChallenge(existing, { name: 'Min första' })
    const legacy = playedChallenge('from-v1-file')
    const user = userEvent.setup()
    render(<App services={services} />)
    await user.upload(await openSettings(user), jsonFile(v1BackupJson(legacy)))

    const dialog = await screen.findByRole('dialog')
    expect(norm(dialog.textContent)).toContain('ny, separat utmaning')
    expect(within(dialog).queryByRole('radio')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Importera som ny' }))
    await screen.findByText('Utmaningen är importerad som en ny utmaning.')

    const all = await repository.listChallenges()
    expect(all).toHaveLength(2)
    expect(await repository.loadChallenge('existing-id')).toEqual(existing)
    const imported = all.find((challenge) => challenge.id !== 'existing-id')!
    expect(imported.seed).toBe('from-v1-file')
    expect(imported.days).toEqual(legacy.days)
    expect((await repository.listChallengeSummaries()).find((s) => s.id === imported.id)?.origin).toBe('legacy-v1-backup')

    await goTo(user, 'Utmaningar')
    expect(await screen.findByText('Importerad (äldre säkerhetskopia)')).toBeTruthy()
  })

  it('adds a v2 backup as new challenges by default', async () => {
    const source = setup()
    await source.repository.saveChallenge(createChallenge('s1', DEFAULT_CHALLENGE_CONFIG, 's1'), { name: 'Kopia 1' })
    await source.repository.saveChallenge(createChallenge('s2', startedToday, 's2'), { name: 'Kopia 2' })
    const backup = await source.repository.exportBackup('2027-01-01T10:00:00.000Z')

    const { services, repository } = setup()
    const mine = createChallenge('mine', DEFAULT_CHALLENGE_CONFIG, 'mine')
    await repository.saveChallenge(mine, { name: 'Min' })
    const user = userEvent.setup()
    render(<App services={services} />)
    await user.upload(await openSettings(user), jsonFile(backup))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /Lägg till som nya utmaningar/ })).toHaveProperty('checked', true)
    await user.click(within(dialog).getByRole('button', { name: 'Importera som ny' }))
    await screen.findByText('2 utmaningar är importerade som nya.')
    expect(await repository.listChallenges()).toHaveLength(3)
    expect(await repository.loadChallenge('mine')).toEqual(mine)
    expect(await repository.activeChallengeId()).toBe('mine')
  })

  it('replaces everything only after a warning and an explicit confirmation', async () => {
    const source = setup()
    await source.repository.saveChallenge(createChallenge('s1', DEFAULT_CHALLENGE_CONFIG, 's1'), { name: 'Kopia 1' })
    const backup = await source.repository.exportBackup('2027-01-01T10:00:00.000Z')

    const { services, repository } = setup()
    await repository.saveChallenge(createChallenge('mine', DEFAULT_CHALLENGE_CONFIG, 'mine'), { name: 'Min' })
    await repository.saveChallenge(createChallenge('mine2', startedToday, 'mine2'), { name: 'Min 2' })
    const user = userEvent.setup()
    render(<App services={services} />)
    await user.upload(await openSettings(user), jsonFile(backup))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: /Ersätt allt på den här enheten/ }))
    expect(norm(dialog.textContent)).toContain('Alla 2 nuvarande utmaningar tas bort')
    expect(norm(dialog.textContent)).toContain('Varning')
    const replaceButton = within(dialog).getByRole('button', { name: 'Ersätt allt' })
    expect(replaceButton).toHaveProperty('disabled', true)
    expect(await repository.listChallenges()).toHaveLength(2)

    await user.click(within(dialog).getByRole('checkbox'))
    expect(replaceButton).toHaveProperty('disabled', false)
    await user.click(replaceButton)

    await screen.findByText('Säkerhetskopian är återställd.')
    expect((await repository.listChallenges()).map((challenge) => challenge.id)).toEqual(['s1'])
  })

  it('offers to export the current data before replacing it', async () => {
    const blobs = captureDownloads()
    const source = setup()
    await source.repository.saveChallenge(createChallenge('s1', DEFAULT_CHALLENGE_CONFIG, 's1'))
    const backup = await source.repository.exportBackup('2027-01-01T10:00:00.000Z')
    const { services, repository } = setup()
    await repository.saveChallenge(createChallenge('mine', DEFAULT_CHALLENGE_CONFIG, 'mine'))
    const user = userEvent.setup()
    render(<App services={services} />)
    await user.upload(await openSettings(user), jsonFile(backup))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: /Ersätt allt/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Exportera nuvarande data först' }))
    await waitFor(() => expect(blobs).toHaveLength(1))
    expect((JSON.parse(await blobText(blobs[0])) as { challenges: Array<{ id: string }> }).challenges[0].id).toBe('mine')
    expect(await repository.listChallenges()).toHaveLength(1)
  })

  it('rejects an invalid file in plain Swedish without changing anything', async () => {
    const { services, repository } = setup()
    const mine = createChallenge('mine', DEFAULT_CHALLENGE_CONFIG, 'mine')
    await repository.saveChallenge(mine)
    const user = userEvent.setup()
    render(<App services={services} />)
    await user.upload(await openSettings(user), jsonFile('detta är inte json'))

    expect(await screen.findByText(/Filen går inte att läsa som en säkerhetskopia\. Inget på enheten har ändrats\./)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await repository.listChallenges()).toEqual([mine])
  })

  it('shows whether the browser promised to keep the data', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: async () => false, persist: async () => true } })
    const { services, repository } = setup()
    await repository.saveChallenge(createChallenge('p', DEFAULT_CHALLENGE_CONFIG, 'p'))
    const user = userEvent.setup()
    render(<App services={services} />)
    await openSettings(user)
    await waitFor(() => expect(norm(document.body.textContent)).toMatch(/Skyddad mot rensningJa/))
  })
})

describe('legacy migration and damaged data', () => {
  it('opens a real v1 database, keeps the confirmed savings and labels it as coming from the previous version', async () => {
    const { services, repository, name } = setup()
    const legacy = playedChallenge('legacy-ui')
    await seedV1Database(name, { activeRow: { id: 'active', seed: legacy.seed }, entries: legacy.days })
    const before = await snapshotLegacyTables(name)
    const user = userEvent.setup()
    render(<App services={services} />)

    await screen.findByText('Bekräftat sparat')
    const confirmedSum = legacy.days.filter((day) => day.status === 'confirmed').reduce((total, day) => total + day.amount, 0)
    await waitFor(() => expect(balance()).toBe(norm(sek(confirmedSum))))
    await goTo(user, 'Utmaningar')
    expect(await screen.findByText('Från tidigare version')).toBeTruthy()
    expect(await snapshotLegacyTables(name)).toEqual(before)
    expect((await repository.loadChallenge())!.seed).toBe('legacy-ui')
  })

  it('blocks on damaged data, exports it untouched, and continues only after an explicit confirmation', async () => {
    const blobs = captureDownloads()
    const { services, repository, name } = setup()
    const legacy = playedChallenge('damaged-ui')
    await seedV1Database(name, { activeRow: { id: 'active', seed: legacy.seed }, entries: withDay(legacy.days, 20, { amount: 0 }) })
    const before = await snapshotLegacyTables(name)
    const user = userEvent.setup()
    render(<App services={services} />)

    expect(await screen.findByText('Din tidigare data är skadad')).toBeTruthy()
    expect(norm(document.body.textContent)).toContain('Inget har raderats eller ändrats')
    expect(screen.queryByRole('button', { name: 'Idag' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Spara rådata' }))
    await waitFor(() => expect(blobs).toHaveLength(1))
    const raw = JSON.parse(await blobText(blobs[0])) as { warning: string; tables: { dailyEntries: Array<{ amount: number }> } }
    expect(raw.warning).toContain('technical assistance')
    expect(raw.tables.dailyEntries).toHaveLength(181)
    expect(raw.tables.dailyEntries.some((row) => row.amount === 0)).toBe(true)
    expect(await screen.findByText('Rådatan är sparad som en fil på din enhet.')).toBeTruthy()
    expect(await snapshotLegacyTables(name)).toEqual(before)

    await user.click(screen.getByRole('button', { name: 'Fortsätt utan den skadade datan' }))
    const dialog = await screen.findByRole('dialog')
    expect(norm(dialog.textContent)).toContain('raderas inte')
    expect(await repository.listChallenges().catch(() => 'still blocked')).toBe('still blocked')
    await user.click(within(dialog).getByRole('button', { name: 'Ja, fortsätt' }))

    expect(await screen.findByText('Skapa din första utmaning')).toBeTruthy()
    expect(await snapshotLegacyTables(name)).toEqual(before)
  })

  it('does not skip the damaged data when the confirmation is cancelled', async () => {
    const { services, name } = setup()
    const legacy = playedChallenge('cancel-ui')
    await seedV1Database(name, { activeRow: { id: 'active', seed: legacy.seed }, entries: legacy.days.slice(0, 50) })
    const user = userEvent.setup()
    render(<App services={services} />)
    await user.click(await screen.findByRole('button', { name: 'Fortsätt utan den skadade datan' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Avbryt' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Din tidigare data är skadad')).toBeTruthy()
  })
})

describe('other storage problems', () => {
  it('shows a plain explanation, changes nothing, and still lets the raw data be saved', async () => {
    const blobs = captureDownloads()
    const { services, repository } = setup()
    await repository.saveChallenge(createChallenge('broken', DEFAULT_CHALLENGE_CONFIG, 'broken'))
    await repository.database.challengeEntries.update(['broken', '2027-02-01'], { amount: -5 })
    const before = await repository.database.challengeEntries.toArray()
    const user = userEvent.setup()
    render(<App services={services} />)

    expect(await screen.findByText('Datan kunde inte öppnas')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Sparad data kunde inte verifieras')
    expect(screen.getByRole('button', { name: 'Försök igen' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Spara rådata' }))
    await waitFor(() => expect(blobs).toHaveLength(1))
    expect(await blobText(blobs[0])).toContain('-5')
    expect(await repository.database.challengeEntries.toArray()).toEqual(before)
  })

  it('tells the user in plain Swedish when saving the raw data fails, instead of failing silently', async () => {
    const { services, repository } = setup()
    await repository.saveChallenge(createChallenge('broken2', DEFAULT_CHALLENGE_CONFIG, 'broken2'))
    await repository.database.challengeEntries.update(['broken2', '2027-02-01'], { amount: -5 })
    const user = userEvent.setup()
    render(<App services={services} />)
    await screen.findByText('Datan kunde inte öppnas')

    vi.spyOn(repository, 'exportRawLegacyData').mockRejectedValue(new Error('disk problem'))
    await user.click(screen.getByRole('button', { name: 'Spara rådata' }))
    await waitFor(() => expect(screen.getAllByRole('alert').map((node) => node.textContent).join(' ')).toContain('Något gick fel. Försök igen.'))
  })

  it('stops and asks for a reload when a newer copy of the app upgrades the data', async () => {
    const { services, repository, name } = setup()
    await repository.saveChallenge(createChallenge('v', DEFAULT_CHALLENGE_CONFIG, 'v'))
    render(<App services={services} />)
    await screen.findByText('Bekräftat sparat')

    repository.database.on('versionchange').fire(new Event('versionchange'))
    expect(await screen.findByText('Appen behöver laddas om')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ladda om' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Idag' })).toBeNull()
    expect(name).toBeTruthy()
  })
})
