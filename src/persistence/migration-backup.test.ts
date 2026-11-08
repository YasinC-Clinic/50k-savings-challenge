/**
 * BACKUP CONTRACT. Restoring OLD v1 files and round-tripping the NEW multi-challenge v2 format.
 *
 *  - A backup is a complete snapshot of the device: restore REPLACES all challenges, never merges.
 *  - Old v1 files (exported by the launched app) must keep restoring forever: one challenge, default config.
 *  - v2 holds every challenge (active, started-today, custom, completed history) plus the active id.
 *  - Export is deterministic. Any invalid file is rejected with BackupValidationError and changes nothing.
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CHALLENGE_CONFIG,
  confirmDay,
  createChallenge,
  drawToday,
  type Challenge,
  type ChallengeConfig,
} from '../domain/challenge'
import { SavingsDatabase, SavingsRepository } from './savings-repository'
import {
  BACKUP_FORMAT,
  EXPORTED_AT,
  playedChallenge,
  seedV1Challenge,
  snapshotLegacyTables,
  uniqueName,
  v1BackupJson,
  withDay,
} from './testing/v1-fixtures'

const opened: SavingsDatabase[] = []
const names: string[] = []

function openRepository(name = uniqueName('backup')): SavingsRepository {
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
const springCustom: ChallengeConfig = { targetSek: 20_000, startDate: '2026-11-08', endDate: '2027-03-31', initialMinimumSek: 50, preferredMaximumSek: 500 }
const completedPast: ChallengeConfig = { targetSek: 10_000, startDate: '2026-01-01', endDate: '2026-01-31', initialMinimumSek: 50, preferredMaximumSek: 500 }

function fourChallenges(): Challenge[] {
  const standard = confirmDay(drawToday(createChallenge('b-default', DEFAULT_CHALLENGE_CONFIG, 'default-id'), '2027-01-01'), '2027-01-01')
  const today = drawToday(confirmDay(drawToday(createChallenge('b-today', startedToday, 'today-id'), '2026-11-08'), '2026-11-08'), '2026-11-09')
  const custom = createChallenge('b-spring', springCustom, 'spring-id')
  const finished = createChallenge('b-done', completedPast, 'done-id')
  return [standard, today, custom, { ...finished, days: finished.days.map((day) => ({ ...day, status: 'confirmed' as const })) }]
}

async function populate(repository: SavingsRepository, order: Challenge[] = fourChallenges()): Promise<void> {
  for (const challenge of order) await repository.saveChallenge(challenge)
  await repository.setActiveChallenge('today-id')
}

const byId = (a: Challenge, b: Challenge) => a.id.localeCompare(b.id)

async function state(repository: SavingsRepository) {
  return { challenges: (await repository.listChallenges()).sort(byId), active: await repository.activeChallengeId() }
}

interface V2 {
  [key: string]: unknown
  challenges: Array<{ [key: string]: unknown; config: { [key: string]: unknown }; days: Array<{ [key: string]: unknown }> }>
}

async function exportV2(repository: SavingsRepository): Promise<V2> {
  return JSON.parse(await repository.exportBackup(EXPORTED_AT)) as V2
}

describe('G. multi-challenge (v2) backup', () => {
  it('exports every challenge with the documented shape', async () => {
    const repository = openRepository()
    await populate(repository)
    const backup = await exportV2(repository)
    expect(backup).toMatchObject({ format: BACKUP_FORMAT, version: 2, exportedAt: EXPORTED_AT, activeChallengeId: 'today-id' })
    expect(backup.challenges.map((challenge) => challenge.id).sort()).toEqual(['default-id', 'done-id', 'spring-id', 'today-id'])
    backup.challenges.forEach((challenge) => {
      expect(Object.keys(challenge).sort()).toEqual(['config', 'days', 'id', 'seed'])
      expect(Object.keys(challenge.config).sort()).toEqual(['endDate', 'initialMinimumSek', 'preferredMaximumSek', 'startDate', 'targetSek'])
    })
  })

  it('is deterministic and independent of the order challenges were saved in', async () => {
    const forward = openRepository()
    const backward = openRepository()
    await populate(forward)
    await populate(backward, fourChallenges().reverse())
    const first = await forward.exportBackup(EXPORTED_AT)
    expect(await forward.exportBackup(EXPORTED_AT)).toBe(first)
    expect(await backward.exportBackup(EXPORTED_AT)).toBe(first)
  })

  it('round-trips into an empty device preserving every seed, amount, status, config and the active id', async () => {
    const source = openRepository()
    await populate(source)
    const exported = await source.exportBackup(EXPORTED_AT)
    const target = openRepository()
    await target.restoreBackup(exported)

    expect(await state(target)).toEqual(await state(source))
    expect(await target.exportBackup(EXPORTED_AT)).toBe(exported)
    const originals = fourChallenges().sort(byId)
    expect((await state(target)).challenges).toEqual(originals)
  })

  it('keeps confirmations, drawn days and a fully completed past challenge', async () => {
    const source = openRepository()
    await populate(source)
    const target = openRepository()
    await target.restoreBackup(await source.exportBackup(EXPORTED_AT))
    const restored = (await target.listChallenges()).sort(byId)
    const find = (id: string) => restored.find((challenge) => challenge.id === id)!
    expect(find('default-id').days[0].status).toBe('confirmed')
    expect(find('today-id').days.map((day) => day.status).slice(0, 3)).toEqual(['confirmed', 'drawn', 'undrawn'])
    expect(find('done-id').days.every((day) => day.status === 'confirmed')).toBe(true)
    expect(find('spring-id').days.every((day) => day.status === 'undrawn')).toBe(true)
  })

  it('replaces the device state instead of merging', async () => {
    const target = openRepository()
    await target.saveChallenge(createChallenge('old', DEFAULT_CHALLENGE_CONFIG, 'old-id'))
    const source = openRepository()
    await populate(source)
    await target.restoreBackup(await source.exportBackup(EXPORTED_AT))
    const ids = (await target.listChallenges()).map((challenge) => challenge.id).sort()
    expect(ids).toEqual(['default-id', 'done-id', 'spring-id', 'today-id'])
    expect(await target.loadChallenge('old-id')).toBeNull()
  })

  it('survives closing and reopening the database after a restore', async () => {
    const source = openRepository()
    await populate(source)
    const name = uniqueName('backup-reopen')
    const target = openRepository(name)
    await target.restoreBackup(await source.exportBackup(EXPORTED_AT))
    const expected = await state(target)
    target.database.close()
    expect(await state(openRepository(name))).toEqual(expected)
  })

  const rejections: Array<[string, (backup: V2) => void]> = [
    ['an unsupported future version', (b) => { b.version = 3 }],
    ['a wrong format marker', (b) => { b.format = 'something-else' }],
    ['a missing format marker', (b) => { delete b.format }],
    ['an empty challenge list', (b) => { b.challenges = [] }],
    ['a challenge list that is not an array', (b) => { b.challenges = 'nope' as unknown as V2['challenges'] }],
    ['duplicate challenge ids', (b) => { b.challenges[1].id = b.challenges[0].id }],
    ['an unknown active challenge id', (b) => { b.activeChallengeId = 'does-not-exist' }],
    ['a missing active challenge id', (b) => { delete b.activeChallengeId }],
    ['a challenge without an id', (b) => { delete b.challenges[0].id }],
    ['a challenge with an empty id', (b) => { b.challenges[0].id = '' }],
    ['a challenge without a seed', (b) => { delete b.challenges[0].seed }],
    ['a challenge without a config', (b) => { delete (b.challenges[0] as Record<string, unknown>).config }],
    ['an amount of zero', (b) => { b.challenges[0].days[3].amount = 0 }],
    ['an unknown day status', (b) => { b.challenges[0].days[3].status = 'bogus' }],
    ['a missing last day', (b) => { b.challenges[1].days.pop() }],
    ['two days swapped out of order', (b) => { const d = b.challenges[1].days; [d[2], d[3]] = [d[3], d[2]] }],
    ['an end date that no longer matches the days', (b) => { b.challenges[2].config.endDate = '2027-04-30' }],
    ['a target that cannot be reached in the dates', (b) => { b.challenges[2].config.targetSek = 1 }],
    ['an impossible calendar date in the config', (b) => { b.challenges[2].config.startDate = '2026-02-30' }],
    ['a timestamp that is not ISO UTC', (b) => { b.exportedAt = '2027-01-06 09:00' }],
    ['a missing timestamp', (b) => { delete b.exportedAt }],
  ]

  for (const [label, corrupt] of rejections) {
    it(`rejects ${label} and leaves the device untouched`, async () => {
      const repository = openRepository()
      await populate(repository)
      const before = await state(repository)
      const backup = await exportV2(repository)
      corrupt(backup)
      await expect(repository.restoreBackup(JSON.stringify(backup))).rejects.toMatchObject({ name: 'BackupValidationError' })
      expect(await state(repository)).toEqual(before)
    })
  }

  it.each(['{not json', '[]', '"text"', 'null', ''])('rejects the non-backup payload %j', async (payload) => {
    const repository = openRepository()
    await populate(repository)
    const before = await state(repository)
    await expect(repository.restoreBackup(payload)).rejects.toMatchObject({ name: 'BackupValidationError' })
    expect(await state(repository)).toEqual(before)
  })

  it.each(['__challenge_app__', 'active'])('never lets a challenge id %j corrupt internal records (rejected or restored faithfully)', async (reservedId) => {
    const source = openRepository()
    await populate(source)
    const backup = await exportV2(source)
    backup.challenges[0].id = reservedId
    if (backup.activeChallengeId === 'default-id') backup.activeChallengeId = reservedId
    const target = openRepository()
    const outcome = await target.restoreBackup(JSON.stringify(backup)).then(() => 'restored', (error: Error) => error.name)
    if (outcome === 'restored') {
      expect((await target.listChallenges()).map((challenge) => challenge.id)).toContain(reservedId)
      expect((await target.loadChallenge(reservedId))?.seed).toBe('b-default')
      expect(await target.activeChallengeId()).toBe(backup.activeChallengeId)
      expect(await target.listChallenges()).toHaveLength(4)
    } else {
      expect(outcome).toBe('BackupValidationError')
      expect(await target.listChallenges()).toEqual([])
    }
  })
})

describe('F. old v1 JSON backup (exported by the launched app)', () => {
  it('fixture matches the launched v1 file layout exactly', () => {
    const parsed = JSON.parse(v1BackupJson(createChallenge('shape'))) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(['challenge', 'exportedAt', 'format', 'version'])
    expect(Object.keys(parsed.challenge as object).sort()).toEqual(['days', 'seed'])
    expect(parsed.version).toBe(1)
  })

  it('restores into an empty device as one active challenge with the default config', async () => {
    const original = playedChallenge('v1-backup-seed')
    const repository = openRepository()
    await repository.restoreBackup(v1BackupJson(original))
    const restored = await repository.listChallenges()
    expect(restored).toHaveLength(1)
    expect(restored[0].seed).toBe('v1-backup-seed')
    expect(restored[0].config).toEqual(DEFAULT_CHALLENGE_CONFIG)
    expect(restored[0].days).toEqual(original.days)
    expect(await repository.activeChallengeId()).toBe(restored[0].id)
    expect(await repository.loadChallenge()).toEqual(restored[0])
  })

  it.each(['p1', 'p2', 'p3', 'p4'])('preserves all amounts, statuses and confirmations for seed %s', async (seed) => {
    const original = playedChallenge(seed)
    const repository = openRepository()
    await repository.restoreBackup(v1BackupJson(original))
    const restored = (await repository.loadChallenge())!
    expect(restored.days.map((day) => [day.date, day.amount, day.status])).toEqual(original.days.map((day) => [day.date, day.amount, day.status]))
  })

  it('can be exported again as v2 and that file restores to the same challenge', async () => {
    const repository = openRepository()
    await repository.restoreBackup(v1BackupJson(playedChallenge('re-export')))
    const v2 = await repository.exportBackup(EXPORTED_AT)
    expect(JSON.parse(v2)).toMatchObject({ version: 2 })
    const other = openRepository()
    await other.restoreBackup(v2)
    expect(await state(other)).toEqual(await state(repository))
  })

  it('replaces whatever challenges are on the device (a backup is a full snapshot)', async () => {
    const repository = openRepository()
    await populate(repository)
    await repository.restoreBackup(v1BackupJson(playedChallenge('replacement')))
    const remaining = await repository.listChallenges()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].seed).toBe('replacement')
  })

  it('wins over untouched legacy v1 rows, which must not be re-imported afterwards', async () => {
    const name = uniqueName('backup-vs-legacy')
    await seedV1Challenge(name, createChallenge('legacy-rows-seed'))
    const before = await snapshotLegacyTables(name)
    const repository = openRepository(name)
    await repository.restoreBackup(v1BackupJson(playedChallenge('backup-seed')))
    repository.database.close()
    const reopened = openRepository(name)
    expect((await reopened.loadChallenge())?.seed).toBe('backup-seed')
    expect(await reopened.listChallenges()).toHaveLength(1)
    reopened.database.close()
    expect(await snapshotLegacyTables(name)).toEqual(before)
  })

  const invalid: Array<[string, (backup: Record<string, unknown>, challenge: { seed?: unknown; days: unknown[] }) => void]> = [
    ['a wrong format marker', (b) => { b.format = 'nope' }],
    ['a missing challenge', (b) => { delete b.challenge }],
    ['a challenge that is not an object', (b) => { b.challenge = 'x' }],
    ['a missing seed', (_b, c) => { delete c.seed }],
    ['a numeric seed', (_b, c) => { c.seed = 7 }],
    ['180 days', (_b, c) => { c.days = c.days.slice(1) }],
    ['182 days', (_b, c) => { c.days = [...c.days, { date: '2027-07-01', amount: 100, status: 'undrawn' }] }],
    ['an amount of zero', (_b, c) => { c.days = withDay(c.days as never, 7, { amount: 0 }) }],
    ['a fractional amount', (_b, c) => { c.days = withDay(c.days as never, 7, { amount: 99.5 }) }],
    ['an unknown status', (_b, c) => { c.days = withDay(c.days as never, 7, { status: 'bogus' }) }],
    ['days out of order', (_b, c) => { c.days = [...c.days].reverse() }],
    ['an invalid timestamp', (b) => { b.exportedAt = 'yesterday' }],
  ]

  for (const [label, corrupt] of invalid) {
    it(`rejects a v1 file with ${label} and leaves the device untouched`, async () => {
      const repository = openRepository()
      await populate(repository)
      const before = await state(repository)
      const backup = JSON.parse(v1BackupJson(createChallenge('invalid-v1'))) as Record<string, unknown>
      corrupt(backup, backup.challenge as { seed?: unknown; days: unknown[] })
      await expect(repository.restoreBackup(JSON.stringify(backup))).rejects.toMatchObject({ name: 'BackupValidationError' })
      expect(await state(repository)).toEqual(before)
    })
  }
})
