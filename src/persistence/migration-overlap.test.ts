/**
 * ISOLATION CONTRACT. Challenges whose date ranges overlap must never share or overwrite each other's rows.
 * v1 stored entries under a primary key of `date` alone, so the second challenge would have clobbered the first.
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CHALLENGE_CONFIG, confirmDay, createChallenge, drawToday, type Challenge, type ChallengeConfig } from '../domain/challenge'
import { SavingsDatabase, SavingsRepository } from './savings-repository'
import { playedChallenge, seedV1Challenge, snapshotLegacyTables, sum, uniqueName } from './testing/v1-fixtures'

const opened: SavingsDatabase[] = []
const names: string[] = []

function openRepository(name = uniqueName('overlap')): SavingsRepository {
  const database = new SavingsDatabase(name)
  opened.push(database)
  names.push(name)
  return new SavingsRepository(database)
}

afterEach(async () => {
  opened.splice(0).forEach((database) => database.close())
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)))
})

const startedToday: ChallengeConfig = { targetSek: 50_000, startDate: '2026-11-08', endDate: '2027-06-30', initialMinimumSek: 50, preferredMaximumSek: 500 }
const shorter: ChallengeConfig = { targetSek: 20_000, startDate: '2027-01-01', endDate: '2027-03-31', initialMinimumSek: 50, preferredMaximumSek: 500 }
const confirmOn = (challenge: Challenge, date: string) => confirmDay(drawToday(challenge, date), date)
const dayOf = (challenge: Challenge | null, date: string) => challenge?.days.find((day) => day.date === date)

describe('H. multiple challenges with overlapping dates', () => {
  it('keeps two challenges on the exact same dates fully independent', async () => {
    const repository = openRepository()
    const alpha = createChallenge('alpha', DEFAULT_CHALLENGE_CONFIG, 'alpha')
    const beta = createChallenge('beta', DEFAULT_CHALLENGE_CONFIG, 'beta')
    expect(dayOf(alpha, '2027-01-01')?.amount).not.toBe(dayOf(beta, '2027-01-01')?.amount)

    await repository.saveChallenge(alpha)
    await repository.saveChallenge(beta)
    await repository.saveChallenge(confirmOn(alpha, '2027-01-01'))

    expect(dayOf(await repository.loadChallenge('alpha'), '2027-01-01')?.status).toBe('confirmed')
    expect(dayOf(await repository.loadChallenge('beta'), '2027-01-01')).toEqual(dayOf(beta, '2027-01-01'))
    expect((await repository.loadChallenge('beta'))?.days.every((day) => day.status === 'undrawn')).toBe(true)
  })

  it('stores two different confirmed amounts for the same date side by side', async () => {
    const repository = openRepository()
    const alpha = confirmOn(createChallenge('alpha', DEFAULT_CHALLENGE_CONFIG, 'alpha'), '2027-01-01')
    const beta = confirmOn(createChallenge('beta', DEFAULT_CHALLENGE_CONFIG, 'beta'), '2027-01-01')
    await repository.saveChallenge(alpha)
    await repository.saveChallenge(beta)
    expect(dayOf(await repository.loadChallenge('alpha'), '2027-01-01')).toEqual(dayOf(alpha, '2027-01-01'))
    expect(dayOf(await repository.loadChallenge('beta'), '2027-01-01')).toEqual(dayOf(beta, '2027-01-01'))
  })

  it('handles partially overlapping ranges of different length, target and start', async () => {
    const repository = openRepository()
    const full = confirmOn(createChallenge('full', DEFAULT_CHALLENGE_CONFIG, 'full'), '2027-01-01')
    const today = createChallenge('today', startedToday, 'today')
    const short = createChallenge('short', shorter, 'short')
    for (const challenge of [full, today, short]) await repository.saveChallenge(challenge)

    const loaded = await Promise.all(['full', 'today', 'short'].map((id) => repository.loadChallenge(id)))
    expect(loaded.map((challenge) => challenge?.days.length)).toEqual([181, 235, 90])
    expect(loaded.map((challenge) => sum(challenge!.days))).toEqual([50_000, 50_000, 20_000])
    expect(dayOf(loaded[0], '2027-01-01')?.status).toBe('confirmed')
    expect(dayOf(loaded[1], '2027-01-01')?.status).toBe('undrawn')
    expect(dayOf(loaded[2], '2027-01-01')?.status).toBe('undrawn')
  })

  it('applies immutability per challenge: A is protected without freezing B on the same date', async () => {
    const repository = openRepository()
    const alpha = confirmOn(createChallenge('alpha', DEFAULT_CHALLENGE_CONFIG, 'alpha'), '2027-01-01')
    const beta = createChallenge('beta', DEFAULT_CHALLENGE_CONFIG, 'beta')
    await repository.saveChallenge(alpha)
    await repository.saveChallenge(beta)

    const tampered = { ...alpha, days: alpha.days.map((day, index) => (index === 0 ? { ...day, amount: day.amount + 1 } : day)) }
    await expect(repository.saveChallenge(tampered)).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
    await repository.saveChallenge(confirmOn(beta, '2027-01-01'))
    expect(dayOf(await repository.loadChallenge('alpha'), '2027-01-01')).toEqual(dayOf(alpha, '2027-01-01'))
    expect(dayOf(await repository.loadChallenge('beta'), '2027-01-01')?.status).toBe('confirmed')
  })

  it('accepts the same seed under two different ids without merging them', async () => {
    const repository = openRepository()
    const first = createChallenge('shared-seed', DEFAULT_CHALLENGE_CONFIG, 'first')
    const second = createChallenge('shared-seed', DEFAULT_CHALLENGE_CONFIG, 'second')
    await repository.saveChallenge(first)
    await repository.saveChallenge(confirmOn(second, '2027-01-01'))
    expect((await repository.listChallenges()).map((challenge) => challenge.id).sort()).toEqual(['first', 'second'])
    expect(dayOf(await repository.loadChallenge('first'), '2027-01-01')?.status).toBe('undrawn')
  })

  it('switching the active challenge changes nothing else and survives reopening', async () => {
    const name = uniqueName('overlap-switch')
    const repository = openRepository(name)
    const alpha = confirmOn(createChallenge('alpha', DEFAULT_CHALLENGE_CONFIG, 'alpha'), '2027-01-01')
    const beta = createChallenge('beta', startedToday, 'beta')
    await repository.saveChallenge(alpha)
    await repository.saveChallenge(beta)
    expect(await repository.activeChallengeId()).toBe('alpha')

    await repository.setActiveChallenge('beta')
    expect((await repository.loadChallenge())?.id).toBe('beta')
    repository.database.close()

    const reopened = openRepository(name)
    expect(await reopened.activeChallengeId()).toBe('beta')
    expect(await reopened.loadChallenge('alpha')).toEqual(alpha)
    expect(await reopened.loadChallenge('beta')).toEqual(beta)
  })

  it('rejects switching to a challenge that does not exist and keeps the current one active', async () => {
    const repository = openRepository()
    await repository.saveChallenge(createChallenge('alpha', DEFAULT_CHALLENGE_CONFIG, 'alpha'))
    await expect(repository.setActiveChallenge('ghost')).rejects.toMatchObject({ name: 'PersistenceIntegrityError' })
    expect(await repository.activeChallengeId()).toBe('alpha')
  })

  it('returns null for an unknown id instead of falling back to another challenge', async () => {
    const repository = openRepository()
    await repository.saveChallenge(createChallenge('alpha', DEFAULT_CHALLENGE_CONFIG, 'alpha'))
    expect(await repository.loadChallenge('ghost')).toBeNull()
  })

  it('keeps a finished challenge as history while a new one is started on top of the same dates', async () => {
    const repository = openRepository()
    const finished = createChallenge('old-run', DEFAULT_CHALLENGE_CONFIG, 'old-run')
    const completed = { ...finished, days: finished.days.map((day) => ({ ...day, status: 'confirmed' as const })) }
    await repository.saveChallenge(completed)
    await repository.saveChallenge(createChallenge('new-run', DEFAULT_CHALLENGE_CONFIG, 'new-run'))
    await repository.setActiveChallenge('new-run')
    expect(await repository.loadChallenge('old-run')).toEqual(completed)
    expect(sum((await repository.loadChallenge('old-run'))!.days.filter((day) => day.status === 'confirmed'))).toBe(50_000)
  })
})

describe('I. migrating legacy v1 data and then adding overlapping challenges', () => {
  it('keeps the migrated challenge intact when a second challenge on the same dates is created', async () => {
    const name = uniqueName('overlap-after-migration')
    const legacy = playedChallenge('legacy-first')
    await seedV1Challenge(name, legacy)
    const before = await snapshotLegacyTables(name)
    const repository = openRepository(name)

    const migrated = (await repository.loadChallenge())!
    const second = createChallenge('second-run', DEFAULT_CHALLENGE_CONFIG, 'second-run')
    await repository.saveChallenge(confirmOn(second, '2027-01-01'))

    expect((await repository.loadChallenge(migrated.id))?.days).toEqual(legacy.days)
    expect(await repository.activeChallengeId()).toBe(migrated.id)
    expect((await repository.listChallenges()).map((challenge) => challenge.id).sort()).toEqual([migrated.id, 'second-run'].sort())
    repository.database.close()
    expect(await snapshotLegacyTables(name)).toEqual(before)
  })

  it('does not mistake the second challenge for legacy data on the next start', async () => {
    const name = uniqueName('overlap-restart')
    await seedV1Challenge(name, createChallenge('legacy-seed'))
    const first = openRepository(name)
    await first.loadChallenge()
    await first.saveChallenge(confirmOn(createChallenge('extra', startedToday, 'extra'), '2026-11-08'))
    first.database.close()

    const second = openRepository(name)
    const challenges = await second.listChallenges()
    expect(challenges).toHaveLength(2)
    expect(challenges.find((challenge) => challenge.id === 'extra')?.days[0].status).toBe('confirmed')
  })
})
