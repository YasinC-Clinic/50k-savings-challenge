/**
 * Data safety of the penalty ledger and the catch-up savings: idempotent accrual, strict separation from the ordinary
 * savings, the permanent pot, backup/restore with and without a ledger, atomic writes and the additive schema upgrade.
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CHALLENGE_CONFIG, createChallenge, recalculateAfterMisses, type Challenge, type ChallengeConfig } from '../domain/challenge'
import { confirmedSavingsSek, penaltyTotals, type CatchUpEntry } from '../domain/ledger'
import { BackupValidationError, PersistenceIntegrityError } from './errors'
import { SavingsDatabase, SavingsRepository } from './savings-repository'
import { uniqueName } from './testing/v1-fixtures'

const REPLACE = { mode: 'replace', confirmReplace: true } as const
const IMPORT = { mode: 'import-as-new' } as const
const NOW = '2027-01-10T10:00:00.000Z'
const CONFIG: ChallengeConfig = { targetSek: 2_000, startDate: '2027-01-01', endDate: '2027-01-31', initialMinimumSek: 20, preferredMaximumSek: 120 }
const opened: SavingsDatabase[] = []
const names: string[] = []

function open(name = uniqueName('ledger')): SavingsRepository {
  const database = new SavingsDatabase(name)
  opened.push(database)
  names.push(name)
  return new SavingsRepository(database)
}

afterEach(async () => {
  opened.splice(0).forEach((database) => database.close())
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)))
})

/** 2,000 SEK target with 200 SEK already confirmed on day one: 1,800 SEK are still missing. */
function exampleChallenge(id = 'c', config: ChallengeConfig = CONFIG): Challenge {
  const base = createChallenge(`seed-${id}`, config, id)
  return { ...base, days: base.days.map((day, index) => (index === 0 ? { ...day, amount: 200, status: 'confirmed' as const } : { ...day, amount: 60 })) }
}

/** Starts the penalty clock on 1 January, then lets 2, 3 and 4 January pass unconfirmed (as the app would on 5 January). */
async function missThreeDays(repository: SavingsRepository, id = 'c', seed = 'recalc'): Promise<Challenge> {
  await repository.saveChallenge(exampleChallenge(id))
  await repository.accruePenalties(id, '2027-01-01')
  const missed = recalculateAfterMisses((await repository.loadChallenge(id))!, '2027-01-05', seed).challenge
  await repository.saveChallenge(missed)
  return missed
}

const catchUp = (challengeId: string, date: string, amount: number, status: CatchUpEntry['status']): CatchUpEntry => ({
  challengeId,
  date,
  amount,
  status,
  drawnAt: NOW,
  ...(status === 'confirmed' ? { confirmedAt: NOW } : {}),
})

describe('penalty accrual', () => {
  it('writes exactly 54.00 + 52.38 + 50.81 = 157.19 SEK for three missed days of a 2,000 SEK target with 200 SEK saved', async () => {
    const repository = open()
    await missThreeDays(repository)
    const created = await repository.accruePenalties('c', '2027-01-05')
    expect(created.map((entry) => [entry.date, entry.amountOre])).toEqual([['2027-01-02', 5_400], ['2027-01-03', 5_238], ['2027-01-04', 5_081]])
    const ledger = await repository.readLedger()
    expect(penaltyTotals(ledger.penalties, ledger.payments, 'c')).toEqual({ accruedOre: 15_719, paidOre: 0, outstandingOre: 15_719 })
  })

  it('is idempotent: repeated, concurrent (two connections) and reopened runs never charge a date twice', async () => {
    const name = uniqueName('ledger-idem')
    const first = open(name)
    await missThreeDays(first)
    const second = open(name)
    await Promise.all([first.accruePenalties('c', '2027-01-05'), second.accruePenalties('c', '2027-01-05'), first.accruePenalties('c', '2027-01-05')])
    await first.accruePenalties('c', '2027-01-06')
    expect((await first.readLedger()).penalties).toHaveLength(3)

    opened.splice(0).forEach((database) => database.close())
    const reopened = open(name)
    await reopened.accruePenalties('c', '2027-01-07')
    expect((await reopened.readLedger()).penalties).toHaveLength(3)
  })

  it('keeps penalties completely separate from the ordinary savings and the target', async () => {
    const repository = open()
    const before = await missThreeDays(repository)
    await repository.accruePenalties('c', '2027-01-05')
    const after = (await repository.loadChallenge('c'))!
    expect(after).toEqual(before)
    expect(after.config.targetSek).toBe(2_000)
    expect(confirmedSavingsSek(after, [])).toBe(200)
  })

  it('never penalises history from before the feature started on this device (no retroactive penalties)', async () => {
    const repository = open()
    await repository.saveChallenge(exampleChallenge())
    const old = recalculateAfterMisses((await repository.loadChallenge('c'))!, '2027-01-05', 'old').challenge
    await repository.saveChallenge(old)
    expect(await repository.accruePenalties('c', '2027-01-05')).toEqual([])

    const later = recalculateAfterMisses(old, '2027-01-08', 'later').challenge
    await repository.saveChallenge(later)
    const created = await repository.accruePenalties('c', '2027-01-08')
    expect(created.map((entry) => entry.date)).toEqual(['2027-01-05', '2027-01-06', '2027-01-07'])
  })

  it('charges nothing once the target is completed', async () => {
    const repository = open()
    const config: ChallengeConfig = { ...DEFAULT_CHALLENGE_CONFIG, targetSek: 100, startDate: '2027-01-01', endDate: '2027-01-02', initialMinimumSek: 10, preferredMaximumSek: 100 }
    const done: Challenge = { ...createChallenge('done', config, 'd'), days: [{ date: '2027-01-01', amount: 100, status: 'confirmed' }, { date: '2027-01-02', amount: 20, status: 'missed' }] }
    await repository.saveChallenge(done)
    expect(await repository.accruePenalties('d', '2027-01-01')).toEqual([])
    expect(await repository.accruePenalties('d', '2027-01-03')).toEqual([])
    expect((await repository.readLedger()).penalties).toEqual([])
  })

  it('returns nothing for a challenge that does not exist', async () => {
    expect(await open().accruePenalties('missing', '2027-01-01')).toEqual([])
  })
})

describe('penalty payments and the permanent pot', () => {
  it('records only payments the user confirms, never above what is outstanding, and sums the pot over all challenges', async () => {
    const repository = open()
    await missThreeDays(repository, 'c')
    await missThreeDays(repository, 'd', 'recalc-d')
    await repository.accruePenalties('c', '2027-01-05')
    await repository.accruePenalties('d', '2027-01-05')

    await repository.recordPenaltyPayment('c', 5_400)
    let ledger = await repository.readLedger()
    expect(penaltyTotals(ledger.penalties, ledger.payments, 'c')).toEqual({ accruedOre: 15_719, paidOre: 5_400, outstandingOre: 10_319 })
    expect(penaltyTotals(ledger.penalties, ledger.payments, 'd').outstandingOre).toBe(15_719)
    expect(penaltyTotals(ledger.penalties, ledger.payments)).toEqual({ accruedOre: 31_438, paidOre: 5_400, outstandingOre: 26_038 })

    await repository.recordPenaltyPayment('c', 10_319)
    ledger = await repository.readLedger()
    expect(penaltyTotals(ledger.penalties, ledger.payments, 'c').outstandingOre).toBe(0)
  })

  it.each([0, -5, 1.5, Number.NaN, 15_720])('rejects the payment amount %s and changes nothing', async (amount) => {
    const repository = open()
    await missThreeDays(repository)
    await repository.accruePenalties('c', '2027-01-05')
    await expect(repository.recordPenaltyPayment('c', amount)).rejects.toBeInstanceOf(PersistenceIntegrityError)
    expect((await repository.readLedger()).payments).toEqual([])
  })

  it('keeps the pot when a challenge is later replaced by a backup that has no ledger', async () => {
    const repository = open()
    await missThreeDays(repository)
    await repository.accruePenalties('c', '2027-01-05')
    const source = open()
    await source.saveChallenge(createChallenge('other', DEFAULT_CHALLENGE_CONFIG, 'other'))
    const withoutLedger = JSON.parse(await source.exportBackup(NOW)) as Record<string, unknown>
    delete withoutLedger.ledger

    await repository.restoreBackup(JSON.stringify(withoutLedger), REPLACE)
    expect((await repository.readLedger()).penalties).toHaveLength(3)
  })
})

describe('catch-up savings', () => {
  async function withMissedDays() {
    const repository = open()
    const missed = await missThreeDays(repository)
    return { repository, missed }
  }

  it('stores a drawn amount that does not count as saved, then a confirmed one that does, atomically with the challenge', async () => {
    const { repository, missed } = await withMissedDays()
    await repository.saveChallengeWithCatchUp(missed, catchUp('c', '2027-01-02', 70, 'drawn'))
    let ledger = await repository.readLedger()
    expect(confirmedSavingsSek(missed, ledger.catchUps)).toBe(200)

    await repository.saveChallengeWithCatchUp(missed, catchUp('c', '2027-01-02', 70, 'confirmed'))
    ledger = await repository.readLedger()
    expect(confirmedSavingsSek((await repository.loadChallenge('c'))!, ledger.catchUps)).toBe(270)
  })

  it('refuses anything but a missed day and leaves the challenge and the ledger untouched', async () => {
    const { repository, missed } = await withMissedDays()
    await expect(repository.saveChallengeWithCatchUp(missed, catchUp('c', '2027-01-10', 70, 'drawn'))).rejects.toBeInstanceOf(PersistenceIntegrityError)
    await expect(repository.saveChallengeWithCatchUp(missed, catchUp('other', '2027-01-02', 70, 'drawn'))).rejects.toBeInstanceOf(PersistenceIntegrityError)
    expect((await repository.readLedger()).catchUps).toEqual([])
    expect(await repository.loadChallenge('c')).toEqual(missed)
  })

  it('fixes the drawn amount, requires drawing before confirming, and never changes a confirmed catch-up', async () => {
    const { repository, missed } = await withMissedDays()
    await expect(repository.saveChallengeWithCatchUp(missed, catchUp('c', '2027-01-02', 70, 'confirmed'))).rejects.toBeInstanceOf(PersistenceIntegrityError)
    await repository.saveChallengeWithCatchUp(missed, catchUp('c', '2027-01-02', 70, 'drawn'))
    await expect(repository.saveChallengeWithCatchUp(missed, catchUp('c', '2027-01-02', 71, 'confirmed'))).rejects.toBeInstanceOf(PersistenceIntegrityError)
    await repository.saveChallengeWithCatchUp(missed, catchUp('c', '2027-01-02', 70, 'confirmed'))
    await expect(repository.saveChallengeWithCatchUp(missed, catchUp('c', '2027-01-02', 70, 'drawn'))).rejects.toBeInstanceOf(PersistenceIntegrityError)
    expect((await repository.readLedger()).catchUps).toMatchObject([{ date: '2027-01-02', amount: 70, status: 'confirmed' }])
  })

  it('writes the catch-up and the re-spread upcoming days together or not at all', async () => {
    const { repository, missed } = await withMissedDays()
    const broken = { ...missed, days: missed.days.map((day) => (day.date === '2027-01-01' ? { ...day, amount: 1 } : day)) }
    await expect(repository.saveChallengeWithCatchUp(broken, catchUp('c', '2027-01-02', 70, 'drawn'))).rejects.toThrow()
    expect((await repository.readLedger()).catchUps).toEqual([])
    expect((await repository.loadChallenge('c'))!.days[0]).toMatchObject({ amount: 200, status: 'confirmed' })
  })
})

describe('backup and restore with the ledger', () => {
  async function sourceWithLedger() {
    const source = open()
    await missThreeDays(source)
    await source.accruePenalties('c', '2027-01-05')
    await source.recordPenaltyPayment('c', 5_400)
    await source.saveChallengeWithCatchUp((await source.loadChallenge('c'))!, catchUp('c', '2027-01-02', 70, 'drawn'))
    return source
  }

  it('exports the ledger and restores it exactly (replace), including the paid amount', async () => {
    const source = await sourceWithLedger()
    const backup = await source.exportBackup(NOW)
    expect(await source.exportBackup(NOW)).toBe(backup)
    const target = open()
    await target.restoreBackup(backup, REPLACE)
    expect(await target.readLedger()).toEqual(await source.readLedger())
    expect(await target.exportBackup(NOW)).toBe(backup)
  })

  it('imports as new: ids are remapped, nothing that exists is touched, and payments get new ids', async () => {
    const source = await sourceWithLedger()
    const backup = await source.exportBackup(NOW)
    const target = open()
    await target.saveChallenge(createChallenge('mine', DEFAULT_CHALLENGE_CONFIG, 'mine'))
    const before = await target.loadChallenge('mine')

    const result = await target.restoreBackup(backup, IMPORT)
    const [newId] = result.importedChallengeIds
    expect(newId).not.toBe('c')
    const ledger = await target.readLedger()
    expect(ledger.penalties).toHaveLength(3)
    expect(ledger.penalties.every((entry) => entry.challengeId === newId)).toBe(true)
    expect(ledger.catchUps.every((entry) => entry.challengeId === newId)).toBe(true)
    expect(penaltyTotals(ledger.penalties, ledger.payments, newId)).toEqual({ accruedOre: 15_719, paidOre: 5_400, outstandingOre: 10_319 })
    expect(ledger.payments[0].id).not.toBe((await source.readLedger()).payments[0].id)
    expect(await target.loadChallenge('mine')).toEqual(before)
  })

  it('imports a backup from before the ledger existed and leaves the device ledger alone', async () => {
    const source = open()
    await source.saveChallenge(exampleChallenge('old'))
    const old = JSON.parse(await source.exportBackup(NOW)) as Record<string, unknown>
    delete old.ledger
    const target = open()
    await target.saveChallenge(exampleChallenge('mine'))
    await target.accruePenalties('mine', '2027-01-01')
    const before = await target.readLedger()

    const result = await target.restoreBackup(JSON.stringify(old), IMPORT)
    expect(result.importedChallengeIds).toHaveLength(1)
    expect(await target.readLedger()).toEqual(before)
    expect(await target.listChallenges()).toHaveLength(2)
  })

  it.each([
    ['payments above the accrued penalties', (ledger: Record<string, unknown[]>) => { ledger.payments = [{ id: 'p', challengeId: 'c', amountOre: 999_999, paidAt: NOW }] }],
    ['a penalty for an unknown challenge', (ledger: Record<string, unknown[]>) => { (ledger.penalties[0] as { challengeId: string }).challengeId = 'nope' }],
    ['two penalties for the same date', (ledger: Record<string, unknown[]>) => { ledger.penalties.push({ ...(ledger.penalties[0] as object) }) }],
    ['a fractional penalty amount', (ledger: Record<string, unknown[]>) => { (ledger.penalties[0] as { amountOre: number }).amountOre = 54.5 }],
    ['a catch-up that is confirmed without a time', (ledger: Record<string, unknown[]>) => { ledger.catchUps = [{ challengeId: 'c', date: '2027-01-02', amount: 70, status: 'confirmed', drawnAt: NOW }] }],
  ])('rejects a backup with %s and leaves the device exactly as it was', async (_label, corrupt) => {
    const source = await sourceWithLedger()
    const file = JSON.parse(await source.exportBackup(NOW)) as { ledger: Record<string, unknown[]> }
    corrupt(file.ledger)
    const target = open()
    await target.saveChallenge(createChallenge('mine', DEFAULT_CHALLENGE_CONFIG, 'mine'))
    const before = await target.exportBackup(NOW)

    await expect(target.restoreBackup(JSON.stringify(file), REPLACE)).rejects.toBeInstanceOf(BackupValidationError)
    await expect(target.restoreBackup(JSON.stringify(file), IMPORT)).rejects.toBeInstanceOf(BackupValidationError)
    expect(await target.exportBackup(NOW)).toBe(before)
  })
})

describe('new challenge options travel safely', () => {
  it('stores and restores dynamicRange and shockDays, and leaves them absent on challenges that never had them', async () => {
    const source = open()
    const modern = createChallenge('modern', { ...CONFIG, dynamicRange: true, shockDays: true }, 'modern')
    const classic = createChallenge('classic', CONFIG, 'classic')
    await source.saveChallenge(modern)
    await source.saveChallenge(classic)
    expect((await source.loadChallenge('modern'))!.config).toMatchObject({ dynamicRange: true, shockDays: true })
    const stored = (await source.loadChallenge('classic'))!
    expect(stored).toEqual(classic)
    expect('dynamicRange' in stored.config).toBe(false)
    expect('shockDays' in stored.config).toBe(false)

    const target = open()
    await target.restoreBackup(await source.exportBackup(NOW), REPLACE)
    expect(await target.loadChallenge('modern')).toEqual(modern)
    expect(await target.loadChallenge('classic')).toEqual(classic)
  })

  it('rejects a backup whose option flags are not booleans', async () => {
    const source = open()
    await source.saveChallenge(createChallenge('x', CONFIG, 'x'))
    for (const key of ['dynamicRange', 'shockDays']) {
      const file = JSON.parse(await source.exportBackup(NOW)) as { challenges: Array<{ config: Record<string, unknown> }> }
      file.challenges[0].config[key] = 'yes'
      await expect(open().restoreBackup(JSON.stringify(file), REPLACE)).rejects.toBeInstanceOf(BackupValidationError)
    }
  })
})

describe('additive schema upgrade', () => {
  it('opens a version 2 database as version 3 without changing any existing row', async () => {
    const name = uniqueName('ledger-upgrade')
    const writer = open(name)
    await writer.saveChallenge(exampleChallenge('keep'), { name: 'Min kassa' })
    await writer.setActiveChallenge('keep')
    const rows = {
      records: await writer.database.challengeRecords.toArray(),
      entries: await writer.database.challengeEntries.toArray(),
      meta: await writer.database.appMeta.toArray(),
    }
    const expected = (await writer.loadChallenge('keep'))!
    opened.splice(0).forEach((database) => database.close())
    await Dexie.delete(name)

    const legacy = new Dexie(name)
    legacy.version(1).stores({ challenges: 'id', dailyEntries: 'date' })
    legacy.version(2).stores({ challengeRecords: 'id', challengeEntries: '[challengeId+date]', appMeta: 'key' })
    await legacy.table('challengeRecords').bulkAdd(rows.records)
    await legacy.table('challengeEntries').bulkAdd(rows.entries)
    await legacy.table('appMeta').bulkAdd(rows.meta.filter((row) => row.key !== 'penaltiesStartDate'))
    legacy.close()
    expect(legacy.verno).toBe(2)

    const upgraded = open(name)
    expect(await upgraded.loadChallenge('keep')).toEqual(expected)
    expect(await upgraded.activeChallengeId()).toBe('keep')
    expect(await upgraded.readLedger()).toEqual({ penalties: [], payments: [], catchUps: [] })
    expect(upgraded.database.verno).toBe(3)
  })
})
