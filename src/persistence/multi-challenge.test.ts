import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { createChallenge, type ChallengeConfig } from '../domain/challenge'
import { SavingsDatabase, SavingsRepository } from './savings-repository'

const databases: SavingsDatabase[] = []
const todayConfig: ChallengeConfig = { targetSek: 50_000, startDate: '2026-11-08', endDate: '2027-05-07', initialMinimumSek: 50, preferredMaximumSek: 500 }
function repository() { const database = new SavingsDatabase(`multi-${crypto.randomUUID()}`); databases.push(database); return new SavingsRepository(database) }
afterEach(async () => { await Promise.all(databases.splice(0).map(async (database) => { await database.delete(); database.close() })) })

describe('multiple challenges', () => {
  it('keeps independent identities, date ranges, active selection, and backup records', async () => {
    const store = repository(); const first = createChallenge('one'); const second = createChallenge('two', todayConfig)
    await store.saveChallenge(first); await store.saveChallenge(second); await store.setActiveChallenge(second.id)
    expect((await store.listChallenges()).map((challenge) => challenge.id).sort()).toEqual([first.id, second.id].sort())
    expect((await store.loadChallenge())?.id).toBe(second.id)
    const backup = JSON.parse(await store.exportBackup()) as { version: number; challenges: unknown[] }
    expect(backup).toMatchObject({ version: 2 }); expect(backup.challenges).toHaveLength(2)
  })
})
