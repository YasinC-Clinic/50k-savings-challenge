import { useCallback, useEffect, useMemo, useState } from 'react'
import { CHALLENGE, confirmDay, createChallenge, drawToday, getDayPresentation, recalculateAfterMisses, type Challenge, type Recovery } from '../domain/challenge'
import { SavingsDatabase, SavingsRepository, describeBackup } from '../persistence/savings-repository'
import { getDashboard, getMonthlyHistory, shouldRecover, stockholmDateKey } from './savings-view'

function createSeed(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

export function useSavingsChallenge() {
  const [repository] = useState(() => new SavingsRepository(new SavingsDatabase()))
  const [today, setToday] = useState(() => stockholmDateKey())
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [recovery, setRecovery] = useState<Recovery | null>(null)

  useEffect(() => {
    let timer: number | undefined
    const scheduleNextDay = () => {
      const now = new Date()
      const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now)
      const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
      const milliseconds = ((23 - value('hour')) * 3600 + (59 - value('minute')) * 60 + (60 - value('second'))) * 1000 + 100
      timer = window.setTimeout(() => { setToday(stockholmDateKey()); scheduleNextDay() }, milliseconds)
    }
    scheduleNextDay()
    return () => { if (timer !== undefined) window.clearTimeout(timer) }
  }, [])

  const persist = useCallback(async (next: Challenge) => {
    await repository.saveChallenge(next)
    setChallenge(next)
  }, [repository])

  const reconcile = useCallback(async (next: Challenge): Promise<Challenge> => {
    if (!shouldRecover(next, today)) {
      setRecovery(null)
      return next
    }
    const result = recalculateAfterMisses(next, today, createSeed())
    await repository.saveChallenge(result.challenge)
    setRecovery(result.recovery)
    return result.challenge
  }, [repository, today])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        let next = await repository.loadChallenge()
        if (!next) {
          next = createChallenge(createSeed())
          await repository.saveChallenge(next)
        }
        next = await reconcile(next)
        if (!cancelled) setChallenge(next)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to access local savings data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [reconcile, repository])

  const draw = useCallback(async () => {
    if (!challenge) return
    try {
      const next = drawToday(challenge, today)
      await persist(next)
      setNotice('Today’s amount is ready. Confirm it only after you have saved it.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to draw today’s amount.') }
  }, [challenge, persist, today])

  const confirm = useCallback(async () => {
    if (!challenge) return
    try {
      await persist(confirmDay(challenge, today))
      setNotice('Saved and recorded. Well done.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to confirm this saving.') }
  }, [challenge, persist, today])

  const exportBackup = useCallback(async () => {
    try { return await repository.exportBackup() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to export backup.'); return null }
  }, [repository])
  const restoreBackup = useCallback(async (backup: string) => {
    try {
      // Compatibility shim until the phase 5 import UI: v1 files import as a new challenge, v2 files replace.
      const legacy = describeBackup(backup).version === 1
      const result = await repository.restoreBackup(backup, legacy ? { mode: 'import-as-new' } : { mode: 'replace', confirmReplace: true })
      if (legacy) await repository.setActiveChallenge(result.importedChallengeIds[0])
      const restored = await repository.loadChallenge()
      if (!restored) throw new Error('Restored backup contains no challenge')
      setChallenge(await reconcile(restored))
      setNotice('Backup restored successfully.')
      return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to restore backup.'); return false }
  }, [reconcile, repository])

  return {
    challenge, loading, error, notice, recovery, today, draw, confirm, exportBackup, restoreBackup,
    clearMessage: () => { setError(null); setNotice(null) },
    dashboard: useMemo(() => challenge ? getDashboard(challenge, today) : null, [challenge, today]),
    todayEntry: challenge && today >= CHALLENGE.startDate && today <= CHALLENGE.endDate ? getDayPresentation(challenge, today) : null,
    history: challenge ? getMonthlyHistory(challenge) : [],
  }
}
