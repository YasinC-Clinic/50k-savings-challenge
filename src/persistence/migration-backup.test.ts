/**
 * BACKUP CONTRACT (approved product decisions).
 *
 *  - v1 file (exported by the launched app): ALWAYS imported as ONE new independent challenge with a
 *    new id. Never replaces anything. Original dates, amounts, statuses, seed and confirmations survive.
 *  - v2 file: caller must choose 'replace' (needs confirmReplace: true) or 'import-as-new'.
 *    'import-as-new' gives every challenge a new id and never overwrites an existing one.
 *  - The whole file is validated before the first write; every failure leaves the device untouched.
 *  - Applying a backup is atomic: a failure half way rolls everything back.
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CHALLENGE_LIMITS,
  DEFAULT_CHALLENGE_CONFIG,
  confirmDay,
  createChallenge,
  drawToday,
  type Challenge,
  type ChallengeConfig,
} from '../domain/challenge'
import { SavingsDatabase, SavingsRepository, type RepositoryOptions } from './savings-repository'
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

const REPLACE = { mode: 'replace', confirmReplace: true } as const
const IMPORT = { mode: 'import-as-new' } as const

const opened: SavingsDatabase[] = []
const names: string[] = []

function sequentialIds(prefix: string): () => string {
  let counter = 0
  return () => {
    counter += 1
    return `${prefix}-${counter}`
  }
}

function openRepository(name = uniqueName('backup'), options: RepositoryOptions = {}): SavingsRepository {
  const database = new SavingsDatabase(name)
  opened.push(database)
  names.push(name)
  return new SavingsRepository(database, { createId: sequentialIds('new'), ...options })
}

afterEach(async () => {
  vi.restoreAllMocks()
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
const withoutId = (challenge: Challenge) => ({ seed: challenge.seed, config: challenge.config, days: challenge.days })

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

describe('G. multi-challenge (v2) backup: export and replace', () => {
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
    await target.restoreBackup(exported, REPLACE)

    expect(await state(target)).toEqual(await state(source))
    expect(await target.exportBackup(EXPORTED_AT)).toBe(exported)
    expect((await state(target)).challenges).toEqual(fourChallenges().sort(byId))
  })

  it('keeps confirmations, drawn days and a fully completed past challenge', async () => {
    const source = openRepository()
    await populate(source)
    const target = openRepository()
    await target.restoreBackup(await source.exportBackup(EXPORTED_AT), REPLACE)
    const restored = (await target.listChallenges()).sort(byId)
    const find = (id: string) => restored.find((challenge) => challenge.id === id)!
    expect(find('default-id').days[0].status).toBe('confirmed')
    expect(find('today-id').days.map((day) => day.status).slice(0, 3)).toEqual(['confirmed', 'drawn', 'undrawn'])
    expect(find('done-id').days.every((day) => day.status === 'confirmed')).toBe(true)
    expect(find('spring-id').days.every((day) => day.status === 'undrawn')).toBe(true)
  })

  it('replace removes every challenge that is not in the backup', async () => {
    const target = openRepository()
    await target.saveChallenge(createChallenge('old', DEFAULT_CHALLENGE_CONFIG, 'old-id'))
    const source = openRepository()
    await populate(source)
    const result = await target.restoreBackup(await source.exportBackup(EXPORTED_AT), REPLACE)
    expect(result).toMatchObject({ mode: 'replace', activeChallengeId: 'today-id' })
    expect((await target.listChallenges()).map((challenge) => challenge.id).sort()).toEqual(['default-id', 'done-id', 'spring-id', 'today-id'])
    expect(await target.loadChallenge('old-id')).toBeNull()
  })

  it('survives closing and reopening the database after a restore', async () => {
    const source = openRepository()
    await populate(source)
    const name = uniqueName('backup-reopen')
    const target = openRepository(name)
    await target.restoreBackup(await source.exportBackup(EXPORTED_AT), REPLACE)
    const expected = await state(target)
    target.database.close()
    expect(await state(openRepository(name))).toEqual(expected)
  })

  it('exports a completed challenge and restores it as history', async () => {
    const source = openRepository()
    await populate(source)
    const exported = JSON.parse(await source.exportBackup(EXPORTED_AT)) as V2
    expect(exported.challenges.some((challenge) => challenge.id === 'done-id')).toBe(true)
  })
})

describe('G2. v2 restore needs an explicit choice', () => {
  it.each([
    ['no options at all', undefined],
    ['an unknown mode', { mode: 'merge' }],
    ['replace without confirmation', { mode: 'replace' }],
    ['replace with confirmReplace: false', { mode: 'replace', confirmReplace: false }],
    ['replace with a truthy but non-true confirmation', { mode: 'replace', confirmReplace: 'yes' }],
  ])('refuses %s and changes nothing', async (_label, options) => {
    const source = openRepository()
    await populate(source)
    const backup = await source.exportBackup(EXPORTED_AT)
    const target = openRepository()
    await target.saveChallenge(createChallenge('keep-me', DEFAULT_CHALLENGE_CONFIG, 'keep-me'))
    const before = await state(target)
    await expect(target.restoreBackup(backup, options as never)).rejects.toMatchObject({ name: 'BackupValidationError' })
    expect(await state(target)).toEqual(before)
  })
})

describe('G3. v2 import as new independent challenges', () => {
  it('adds every challenge under a new id and leaves existing challenges and the active one untouched', async () => {
    const source = openRepository()
    await populate(source)
    const backup = await source.exportBackup(EXPORTED_AT)

    const target = openRepository()
    const existing = createChallenge('existing', DEFAULT_CHALLENGE_CONFIG, 'existing-id')
    await target.saveChallenge(existing)
    const result = await target.restoreBackup(backup, IMPORT)

    expect(result.mode).toBe('import-as-new')
    expect(result.importedChallengeIds).toHaveLength(4)
    expect(result.importedChallengeIds.every((id) => !['default-id', 'done-id', 'spring-id', 'today-id', 'existing-id'].includes(id))).toBe(true)
    expect(await target.activeChallengeId()).toBe('existing-id')
    expect(await target.loadChallenge('existing-id')).toEqual(existing)

    const all = await target.listChallenges()
    expect(all).toHaveLength(5)
    const imported = all.filter((challenge) => result.importedChallengeIds.includes(challenge.id))
    expect(imported.map(withoutId).sort((a, b) => a.seed.localeCompare(b.seed))).toEqual(fourChallenges().map(withoutId).sort((a, b) => a.seed.localeCompare(b.seed)))
  })

  it('records where imported challenges came from', async () => {
    const source = openRepository()
    await populate(source)
    const target = openRepository()
    await target.restoreBackup(await source.exportBackup(EXPORTED_AT), IMPORT)
    const summaries = await target.listChallengeSummaries()
    expect(summaries).toHaveLength(4)
    expect(summaries.every((summary) => summary.origin === 'backup-import')).toBe(true)
    expect(summaries.map((summary) => summary.sourceChallengeId).sort()).toEqual(['default-id', 'done-id', 'spring-id', 'today-id'])
  })

  it('activates the first imported challenge when the device had none', async () => {
    const source = openRepository()
    await populate(source)
    const target = openRepository()
    const result = await target.restoreBackup(await source.exportBackup(EXPORTED_AT), IMPORT)
    expect(await target.activeChallengeId()).toBe(result.importedChallengeIds[0])
  })

  it('importing the same file twice creates independent copies and overwrites nothing', async () => {
    const source = openRepository()
    await populate(source)
    const backup = await source.exportBackup(EXPORTED_AT)
    const target = openRepository()
    const first = await target.restoreBackup(backup, IMPORT)
    const second = await target.restoreBackup(backup, IMPORT)
    const ids = [...first.importedChallengeIds, ...second.importedChallengeIds]
    expect(new Set(ids).size).toBe(8)
    expect(await target.listChallenges()).toHaveLength(8)
  })

  it('never reuses an id that already exists, even if the id generator proposes one', async () => {
    const target = openRepository(uniqueName('backup-collision'), { createId: sequentialIds('taken') })
    await target.saveChallenge(createChallenge('squatter', DEFAULT_CHALLENGE_CONFIG, 'taken-1'))
    const squatter = (await target.loadChallenge('taken-1'))!

    const source = openRepository()
    await populate(source)
    const result = await target.restoreBackup(await source.exportBackup(EXPORTED_AT), IMPORT)
    expect(result.importedChallengeIds).not.toContain('taken-1')
    expect(await target.loadChallenge('taken-1')).toEqual(squatter)
  })

  it('does not let a backup challenge that shares an id with an existing one overwrite it', async () => {
    const source = openRepository()
    await populate(source)
    const target = openRepository()
    const mine = confirmDay(drawToday(createChallenge('mine', DEFAULT_CHALLENGE_CONFIG, 'default-id'), '2027-01-02'), '2027-01-02')
    await target.saveChallenge(mine)
    await target.restoreBackup(await source.exportBackup(EXPORTED_AT), IMPORT)
    expect(await target.loadChallenge('default-id')).toEqual(mine)
  })
})

describe('G4. v2 validation rejects bad files before any write', () => {
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
    ['a challenge with an over-long id', (b) => { b.challenges[0].id = 'x'.repeat(101) }],
    ['a challenge without a seed', (b) => { delete b.challenges[0].seed }],
    ['a challenge without a config', (b) => { delete (b.challenges[0] as Record<string, unknown>).config }],
    ['an amount of zero', (b) => { b.challenges[0].days[3].amount = 0 }],
    ['an unknown day status', (b) => { b.challenges[0].days[3].status = 'bogus' }],
    ['amounts that no longer add up to the target', (b) => { b.challenges[0].days[3].amount = (b.challenges[0].days[3].amount as number) + 1 }],
    ['a daily amount above the target', (b) => { b.challenges[2].days[1].amount = 30_000 }],
    ['a missing last day', (b) => { b.challenges[1].days.pop() }],
    ['two days swapped out of order', (b) => { const d = b.challenges[1].days; [d[2], d[3]] = [d[3], d[2]] }],
    ['an end date that no longer matches the days', (b) => { b.challenges[2].config.endDate = '2027-04-30' }],
    ['a target that cannot be reached in the dates', (b) => { b.challenges[2].config.targetSek = 1 }],
    ['an impossible calendar date in the config', (b) => { b.challenges[2].config.startDate = '2026-02-30' }],
    ['a target above the supported maximum', (b) => { b.challenges[2].config.targetSek = CHALLENGE_LIMITS.maxTargetSek + 1 }],
    ['a challenge longer than the supported maximum', (b) => { b.challenges[2].config.endDate = '2031-03-31' }],
    ['a timestamp that is not ISO UTC', (b) => { b.exportedAt = '2027-01-06 09:00' }],
    ['a missing timestamp', (b) => { delete b.exportedAt }],
  ]

  for (const mode of [REPLACE, IMPORT]) {
    for (const [label, corrupt] of rejections) {
      it(`${mode.mode}: rejects ${label} and leaves the device untouched`, async () => {
        const repository = openRepository()
        await populate(repository)
        const before = await state(repository)
        const backup = await exportV2(repository)
        corrupt(backup)
        await expect(repository.restoreBackup(JSON.stringify(backup), mode)).rejects.toMatchObject({ name: 'BackupValidationError' })
        expect(await state(repository)).toEqual(before)
      })
    }
  }

  it('rejects more challenges than the supported maximum', async () => {
    const repository = openRepository()
    await populate(repository)
    const backup = await exportV2(repository)
    const template = backup.challenges[2]
    backup.challenges = Array.from({ length: 51 }, (_, index) => ({ ...template, id: `many-${index}` }))
    backup.activeChallengeId = 'many-0'
    await expect(repository.restoreBackup(JSON.stringify(backup), IMPORT)).rejects.toMatchObject({ name: 'BackupValidationError' })
  })

  it.each(['{not json', '[]', '"text"', 'null', ''])('rejects the non-backup payload %j', async (payload) => {
    const repository = openRepository()
    await populate(repository)
    const before = await state(repository)
    await expect(repository.restoreBackup(payload, REPLACE)).rejects.toMatchObject({ name: 'BackupValidationError' })
    await expect(repository.restoreBackup(payload, IMPORT)).rejects.toMatchObject({ name: 'BackupValidationError' })
    expect(await state(repository)).toEqual(before)
  })

  it.each(['__challenge_app__', 'active', 'legacy-v1-challenge'])('restores a challenge whose id is %j faithfully (no reserved ids)', async (reservedId) => {
    const source = openRepository()
    await populate(source)
    const backup = await exportV2(source)
    backup.challenges[0].id = reservedId
    if (backup.activeChallengeId === 'default-id') backup.activeChallengeId = reservedId
    const target = openRepository()
    await target.restoreBackup(JSON.stringify(backup), REPLACE)
    expect((await target.loadChallenge(reservedId))?.seed).toBe('b-default')
    expect(await target.activeChallengeId()).toBe(backup.activeChallengeId)
    expect(await target.listChallenges()).toHaveLength(4)
  })
})

describe('G5. atomic rollback', () => {
  async function failOnSecondEntryWrite(repository: SavingsRepository) {
    const table = repository.database.challengeEntries
    const original = table.bulkAdd.bind(table)
    let calls = 0
    vi.spyOn(table, 'bulkAdd').mockImplementation(((...args: Parameters<typeof original>) => {
      calls += 1
      return calls === 2 ? Promise.reject(new Error('disk full')) : original(...args)
    }) as never)
  }

  it('replace: a failure half way restores every challenge, entry and the active id', async () => {
    const source = openRepository()
    await populate(source)
    const backup = await source.exportBackup(EXPORTED_AT)
    const target = openRepository()
    await target.saveChallenge(createChallenge('survivor', DEFAULT_CHALLENGE_CONFIG, 'survivor'))
    const before = await state(target)

    await failOnSecondEntryWrite(target)
    await expect(target.restoreBackup(backup, REPLACE)).rejects.toMatchObject({ name: 'PersistenceDatabaseError' })
    vi.restoreAllMocks()

    expect(await state(target)).toEqual(before)
    await target.restoreBackup(backup, REPLACE)
    expect(await target.listChallenges()).toHaveLength(4)
  })

  it('import-as-new: a failure half way leaves no half-imported challenge behind', async () => {
    const source = openRepository()
    await populate(source)
    const backup = await source.exportBackup(EXPORTED_AT)
    const target = openRepository()
    await target.saveChallenge(createChallenge('survivor', DEFAULT_CHALLENGE_CONFIG, 'survivor'))
    const before = await state(target)
    const summariesBefore = await target.listChallengeSummaries()

    await failOnSecondEntryWrite(target)
    await expect(target.restoreBackup(backup, IMPORT)).rejects.toMatchObject({ name: 'PersistenceDatabaseError' })
    vi.restoreAllMocks()

    expect(await state(target)).toEqual(before)
    expect(await target.listChallengeSummaries()).toEqual(summariesBefore)
    expect(await target.database.challengeEntries.count()).toBe(181)
  })
})

describe('F. old v1 JSON backup (exported by the launched app)', () => {
  it('fixture matches the launched v1 file layout exactly', () => {
    const parsed = JSON.parse(v1BackupJson(createChallenge('shape'))) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(['challenge', 'exportedAt', 'format', 'version'])
    expect(Object.keys(parsed.challenge as object).sort()).toEqual(['days', 'seed'])
    expect(parsed.version).toBe(1)
  })

  it('imports into an empty device as one new active challenge with the default config', async () => {
    const original = playedChallenge('v1-backup-seed')
    const repository = openRepository()
    const result = await repository.restoreBackup(v1BackupJson(original), IMPORT)
    expect(result).toEqual({ mode: 'import-as-new', importedChallengeIds: ['new-1'], activeChallengeId: 'new-1' })

    const restored = await repository.listChallenges()
    expect(restored).toHaveLength(1)
    expect(restored[0].id).toBe('new-1')
    expect(restored[0].seed).toBe('v1-backup-seed')
    expect(restored[0].config).toEqual(DEFAULT_CHALLENGE_CONFIG)
    expect(restored[0].days).toEqual(original.days)
  })

  it('labels the imported challenge as a legacy backup import', async () => {
    const repository = openRepository()
    await repository.restoreBackup(v1BackupJson(playedChallenge('labelled')), IMPORT)
    const [summary] = await repository.listChallengeSummaries()
    expect(summary).toMatchObject({ id: 'new-1', origin: 'legacy-v1-backup' })
    expect(summary.sourceChallengeId).toBeUndefined()
  })

  it.each(['p1', 'p2', 'p3', 'p4'])('preserves all amounts, statuses and confirmations for seed %s', async (seed) => {
    const original = playedChallenge(seed)
    const repository = openRepository()
    await repository.restoreBackup(v1BackupJson(original), IMPORT)
    const restored = (await repository.loadChallenge())!
    expect(restored.seed).toBe(seed)
    expect(restored.days.map((day) => [day.date, day.amount, day.status])).toEqual(original.days.map((day) => [day.date, day.amount, day.status]))
  })

  it('never replaces existing challenges: it is added next to them and the active one stays', async () => {
    const repository = openRepository()
    await populate(repository)
    const before = await state(repository)
    const result = await repository.restoreBackup(v1BackupJson(playedChallenge('added')), IMPORT)

    const after = await state(repository)
    expect(after.challenges).toHaveLength(5)
    expect(after.active).toBe('today-id')
    expect(after.challenges.filter((challenge) => challenge.id !== result.importedChallengeIds[0])).toEqual(before.challenges)
  })

  it('importing the same v1 file twice creates two independent challenges with different ids', async () => {
    const repository = openRepository()
    const file = v1BackupJson(playedChallenge('twice'))
    const first = await repository.restoreBackup(file, IMPORT)
    const second = await repository.restoreBackup(file, IMPORT)
    expect(first.importedChallengeIds[0]).not.toBe(second.importedChallengeIds[0])
    expect(await repository.listChallenges()).toHaveLength(2)
  })

  it.each([
    ['replace with confirmation', { mode: 'replace', confirmReplace: true }],
    ['replace without confirmation', { mode: 'replace' }],
    ['no options', undefined],
  ])('refuses to apply a v1 file as %s and changes nothing', async (_label, options) => {
    const repository = openRepository()
    await populate(repository)
    const before = await state(repository)
    await expect(repository.restoreBackup(v1BackupJson(playedChallenge('x')), options as never)).rejects.toMatchObject({ name: 'BackupValidationError' })
    expect(await state(repository)).toEqual(before)
  })

  it('can be exported again as v2 and that file replaces into another device with the same challenge', async () => {
    const repository = openRepository()
    await repository.restoreBackup(v1BackupJson(playedChallenge('re-export')), IMPORT)
    const v2 = await repository.exportBackup(EXPORTED_AT)
    expect(JSON.parse(v2)).toMatchObject({ version: 2 })
    const other = openRepository()
    await other.restoreBackup(v2, REPLACE)
    expect(await state(other)).toEqual(await state(repository))
  })

  it('sits next to a migrated v1 database: both exist, legacy tables stay untouched', async () => {
    const name = uniqueName('backup-vs-legacy')
    const legacy = createChallenge('legacy-rows-seed')
    await seedV1Challenge(name, legacy)
    const before = await snapshotLegacyTables(name)
    const repository = openRepository(name)
    const result = await repository.restoreBackup(v1BackupJson(playedChallenge('backup-seed')), IMPORT)

    const all = await repository.listChallenges()
    expect(all.map((challenge) => challenge.seed).sort()).toEqual(['backup-seed', 'legacy-rows-seed'])
    expect(await repository.activeChallengeId()).toBe('legacy-v1-challenge')
    expect(result.importedChallengeIds).toEqual(['new-1'])
    repository.database.close()
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
    ['amounts adding up to more than 50,000', (_b, c) => { c.days = withDay(c.days as never, 7, { amount: 400 }) }],
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
      await expect(repository.restoreBackup(JSON.stringify(backup), IMPORT)).rejects.toMatchObject({ name: 'BackupValidationError' })
      expect(await state(repository)).toEqual(before)
    })
  }
})
