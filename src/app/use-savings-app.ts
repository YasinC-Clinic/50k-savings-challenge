import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  confirmDay,
  createChallenge,
  drawToday,
  recalculateAfterMisses,
  type Challenge,
  type ChallengeConfig,
  type Recovery,
} from '../domain/challenge'
import {
  acceptShockDay,
  catchUpDates,
  catchUpRange,
  drawCatchUpAmount,
  proposeShockAmount,
  rebalanceUpcoming,
  shockRange,
  type CatchUpEntry,
} from '../domain/ledger'
import { EMPTY_LEDGER, type Ledger } from '../persistence/ledger'
import {
  LegacyDataDamagedError,
  PersistenceVersionError,
  SavingsDatabase,
  SavingsRepository,
  describeBackup,
  type BackupSummary,
  type ChallengeOrigin,
} from '../persistence/savings-repository'
import { millisecondsUntilStockholmMidnight, shouldRecover, stockholmDateKey } from './savings-view'

export interface AppServices {
  repository: SavingsRepository
  /** Current instant. Injectable so tests can move the clock. */
  now: () => Date
}

export function createAppServices(): AppServices {
  return { repository: new SavingsRepository(new SavingsDatabase()), now: () => new Date() }
}

export interface ChallengeItem {
  id: string
  name: string | null
  origin: ChallengeOrigin
  createdAt: string
  challenge: Challenge
}

export type AppPhase =
  | { kind: 'loading' }
  | { kind: 'ready' }
  /** Data of the previous app version is damaged: export it, then explicitly continue without it. */
  | { kind: 'legacy-damaged' }
  | { kind: 'storage-problem'; error: unknown }
  /** A newer version of the app has upgraded the stored data; this copy must reload. */
  | { kind: 'outdated' }

/**
 * What happened, without any text. The screen turns it into words in the CURRENT language, so a message that is
 * already visible changes language together with the rest of the interface.
 */
export type FeedbackMessage =
  | { kind: 'drawn' }
  | { kind: 'confirmed' }
  | { kind: 'created' }
  | { kind: 'restored' }
  | { kind: 'imported'; count: number }
  | { kind: 'date-changed' }
  | { kind: 'shock-accepted' }
  | { kind: 'catch-up-confirmed' }
  | { kind: 'penalty-paid' }
  | { kind: 'error'; error: unknown }

export interface Feedback {
  tone: 'success' | 'error' | 'info'
  message: FeedbackMessage
}

/** The plan was recalculated because of missed days; shown once, in the current language. */
export interface RecoveryNoticeData {
  recovery: Recovery
  config: ChallengeConfig
}

export type ImportMode = 'import-as-new' | 'replace'

export interface NewChallengeInput {
  name: string
  config: ChallengeConfig
}

const FEEDBACK_VISIBLE_MS = 7000

function randomId(): string {
  return globalThis.crypto.randomUUID()
}

/** Today's date in Stockholm. Refreshes at midnight and whenever the app becomes visible again. */
function useStockholmToday(now: () => Date): [string, () => void] {
  const [today, setToday] = useState(() => stockholmDateKey(now()))
  const refresh = useCallback(() => setToday(stockholmDateKey(now())), [now])

  useEffect(() => {
    let timer: number | undefined
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        refresh()
        schedule()
      }, millisecondsUntilStockholmMidnight(now()))
    }
    const onResume = () => {
      refresh()
      schedule()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onResume()
    }
    schedule()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onResume)
    window.addEventListener('focus', onResume)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onResume)
      window.removeEventListener('focus', onResume)
    }
  }, [now, refresh])

  return [today, refresh]
}

/** Asks the browser not to evict the saved data. Returns null where the API does not exist. */
async function requestPersistentStorage(): Promise<boolean | null> {
  const storage = globalThis.navigator?.storage
  if (!storage?.persist || !storage.persisted) return null
  if (await storage.persisted()) return true
  return storage.persist()
}

export function useSavingsApp(services: AppServices) {
  const { repository, now } = services
  const [today, refreshToday] = useStockholmToday(now)
  const [phase, setPhase] = useState<AppPhase>({ kind: 'loading' })
  const [items, setItems] = useState<ChallengeItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [notice, setNotice] = useState<RecoveryNoticeData | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [ledger, setLedger] = useState<Ledger>(EMPTY_LEDGER)
  const [catchUpOpen, setCatchUpOpen] = useState(false)
  const [shockDraw, setShockDraw] = useState<{ key: string; attempt: number; amount: number } | null>(null)
  const busy = useRef(false)
  const loadToken = useRef(0)

  const fail = useCallback((error: unknown) => setFeedback({ tone: 'error', message: { kind: 'error', error } }), [])

  /** Loads everything from the database and brings the ACTIVE challenge up to date for `todayKey`. */
  const reload = useCallback(async (todayKey: string) => {
    const token = ++loadToken.current
    try {
      const summaries = await repository.listChallengeSummaries()
      const challenges = await repository.listChallenges()
      let active = await repository.activeChallengeId()
      if (!active && challenges.length > 0) {
        active = challenges[0].id
        await repository.setActiveChallenge(active)
      }

      const byId = new Map(challenges.map((challenge) => [challenge.id, challenge]))
      const current = active ? byId.get(active) : undefined
      let recoveryResult: RecoveryNoticeData | null = null
      if (current && shouldRecover(current, todayKey)) {
        // Catch-up amounts are already fixed outside the daily entries, so the re-spread must leave room for them.
        const stored = await repository.readLedger()
        const fixedSek = stored.catchUps.filter((entry) => entry.challengeId === current.id).reduce((total, entry) => total + entry.amount, 0)
        const result = recalculateAfterMisses(current, todayKey, randomId(), fixedSek)
        await repository.saveChallenge(result.challenge)
        byId.set(current.id, result.challenge)
        recoveryResult = { recovery: result.recovery, config: current.config }
      }
      // Penalties for missed days: idempotent, separate from the savings, never for a completed target.
      if (current) await repository.accruePenalties(current.id, todayKey)
      const freshLedger = await repository.readLedger()

      if (token !== loadToken.current) return
      setLedger(freshLedger)
      setItems(
        summaries.flatMap((summary) => {
          const challenge = byId.get(summary.id)
          if (!challenge) return []
          return [{ id: summary.id, name: summary.name ?? null, origin: summary.origin, createdAt: summary.createdAt, challenge }]
        }),
      )
      setActiveId(active)
      if (recoveryResult) setNotice(recoveryResult)
      setPhase({ kind: 'ready' })
    } catch (error) {
      if (token !== loadToken.current) return
      if (error instanceof LegacyDataDamagedError) setPhase({ kind: 'legacy-damaged' })
      else if (error instanceof PersistenceVersionError) setPhase({ kind: 'outdated' })
      else setPhase({ kind: 'storage-problem', error })
    }
  }, [repository])

  useEffect(() => {
    // Synchronises React state with IndexedDB (an external system); it must re-run whenever the date changes.
    // oxlint-disable-next-line react/set-state-in-effect
    void reload(today)
  }, [reload, today])

  // Confirmations fade away; errors stay until dismissed so they cannot be missed.
  useEffect(() => {
    if (!feedback || feedback.tone === 'error') return undefined
    const timer = window.setTimeout(() => setFeedback(null), FEEDBACK_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [feedback])

  useEffect(() => {
    void requestPersistentStorage().then(setPersisted, () => setPersisted(null))
  }, [])

  useEffect(() => {
    const onVersionChange = () => setPhase({ kind: 'outdated' })
    repository.database.on('versionchange', onVersionChange)
    return () => {
      repository.database.on('versionchange').unsubscribe(onVersionChange)
    }
  }, [repository])

  const active = useMemo(() => items.find((item) => item.id === activeId) ?? null, [items, activeId])

  /** Runs one user action at a time and turns any failure into a friendly message. */
  const act = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined
    busy.current = true
    try {
      return await action()
    } catch (error) {
      fail(error)
      return undefined
    } finally {
      busy.current = false
    }
  }, [fail])

  /** True when the stored day is stale: the date moved on while the app was in the background. */
  const dateMovedOn = useCallback(() => {
    if (stockholmDateKey(now()) === today) return false
    refreshToday()
    setFeedback({ tone: 'info', message: { kind: 'date-changed' } })
    return true
  }, [now, today, refreshToday])

  const replaceChallenge = useCallback((next: Challenge) => {
    setItems((previous) => previous.map((item) => (item.id === next.id ? { ...item, challenge: next } : item)))
  }, [])

  const draw = useCallback(() => act(async () => {
    if (!active || dateMovedOn()) return
    const next = drawToday(active.challenge, today)
    await repository.saveChallenge(next)
    replaceChallenge(next)
    setFeedback({ tone: 'info', message: { kind: 'drawn' } })
  }), [act, active, dateMovedOn, repository, replaceChallenge, today])

  const confirm = useCallback(() => act(async () => {
    if (!active || dateMovedOn()) return
    const next = confirmDay(active.challenge, today)
    await repository.saveChallenge(next)
    replaceChallenge(next)
    setFeedback({ tone: 'success', message: { kind: 'confirmed' } })
  }), [act, active, dateMovedOn, repository, replaceChallenge, today])

  const createNewChallenge = useCallback((input: NewChallengeInput) => act(async () => {
    const id = randomId()
    const challenge = createChallenge(randomId(), input.config, id)
    await repository.saveChallenge(challenge, { name: input.name })
    await repository.setActiveChallenge(id)
    setNotice(null)
    setCatchUpOpen(false)
    await reload(today)
    setFeedback({ tone: 'success', message: { kind: 'created' } })
    return id
  }), [act, reload, repository, today])

  const switchChallenge = useCallback((id: string) => act(async () => {
    await repository.setActiveChallenge(id)
    setNotice(null)
    setCatchUpOpen(false)
    await reload(today)
  }), [act, reload, repository, today])

  const renameChallenge = useCallback((id: string, name: string) => act(async () => {
    await repository.renameChallenge(id, name)
    await reload(today)
  }), [act, reload, repository, today])

  const exportBackup = useCallback(() => act(() => repository.exportBackup()), [act, repository])

  const exportRawData = useCallback(() => act(() => repository.exportRawLegacyData()), [act, repository])

  /** Validates a file and describes it, without changing anything. */
  const inspectBackup = useCallback((text: string): BackupSummary => describeBackup(text), [])

  const importBackup = useCallback((text: string, mode: ImportMode) => act(async () => {
    const options = mode === 'replace' ? ({ mode, confirmReplace: true } as const) : ({ mode } as const)
    const result = await repository.restoreBackup(text, options)
    if (mode === 'import-as-new' && result.importedChallengeIds.length === 1) {
      await repository.setActiveChallenge(result.importedChallengeIds[0])
    }
    setNotice(null)
    setCatchUpOpen(false)
    await reload(today)
    const count = result.importedChallengeIds.length
    setFeedback({ tone: 'success', message: mode === 'replace' ? { kind: 'restored' } : { kind: 'imported', count } })
    return true
  }), [act, reload, repository, today])

  const skipDamagedData = useCallback(() => act(async () => {
    await repository.skipDamagedLegacyData()
    setPhase({ kind: 'loading' })
    await reload(today)
  }), [act, reload, repository, today])

  const retry = useCallback(() => {
    setPhase({ kind: 'loading' })
    void reload(today)
  }, [reload, today])

  const activeCatchUps = useMemo(
    () => (active ? ledger.catchUps.filter((entry) => entry.challengeId === active.id) : []),
    [active, ledger],
  )
  const hasDrawnCatchUp = activeCatchUps.some((entry) => entry.status === 'drawn')

  // ---- Shock Day: only a proposal. Nothing is stored until the user accepts, and never while catching up. -----
  const shock = useMemo(() => {
    if (!active || catchUpOpen || hasDrawnCatchUp) return null
    const range = shockRange(active.challenge, today, activeCatchUps)
    if (!range) return null
    const key = `${active.id}:${today}`
    const seed = `${active.challenge.seed}:${today}`
    const stored = shockDraw?.key === key ? shockDraw : null
    const fits = stored !== null && stored.amount >= range.minimumSek && stored.amount <= range.maximumSek
    const attempt = stored?.attempt ?? 0
    const amount = stored !== null && fits ? stored.amount : proposeShockAmount(range, null, seed, attempt)
    return { key, seed, range, amount, attempt }
  }, [active, activeCatchUps, catchUpOpen, hasDrawnCatchUp, shockDraw, today])

  const drawShockAgain = useCallback(() => {
    if (!shock) return
    const attempt = shock.attempt + 1
    setShockDraw({ key: shock.key, attempt, amount: proposeShockAmount(shock.range, shock.amount, shock.seed, attempt) })
  }, [shock])

  const acceptShock = useCallback(() => act(async () => {
    if (!active || !shock || dateMovedOn()) return
    const next = acceptShockDay(active.challenge, today, shock.amount, activeCatchUps, randomId())
    await repository.saveChallenge(next)
    replaceChallenge(next)
    setFeedback({ tone: 'info', message: { kind: 'shock-accepted' } })
  }), [act, active, activeCatchUps, dateMovedOn, repository, replaceChallenge, shock, today])

  // ---- Catch-up: one missed day at a time, each with its own fixed amount that counts only once confirmed. ------
  const pendingCatchUps = useMemo(() => (active ? catchUpDates(active.challenge, activeCatchUps) : []), [active, activeCatchUps])
  const currentCatchUpDate = pendingCatchUps[0] ?? null
  const currentCatchUp = currentCatchUpDate ? (activeCatchUps.find((entry) => entry.date === currentCatchUpDate && entry.status === 'drawn') ?? null) : null
  const confirmedCatchUps = activeCatchUps.filter((entry) => entry.status === 'confirmed').length
  const catchUpNoRoom = Boolean(active && currentCatchUpDate && !currentCatchUp && catchUpRange(active.challenge, today, activeCatchUps) === null)

  /** Draws and stores (as "drawn", not saved) the amount for the oldest missed day that has none. */
  const drawCatchUpFor = useCallback(async (challenge: Challenge, entries: CatchUpEntry[]): Promise<boolean> => {
    const date = catchUpDates(challenge, entries)[0]
    if (!date || entries.some((entry) => entry.date === date && entry.status === 'drawn')) return Boolean(date)
    const amount = drawCatchUpAmount(challenge, today, entries, date)
    if (amount === null) return false
    await repository.saveChallengeWithCatchUp(challenge, { challengeId: challenge.id, date, amount, status: 'drawn', drawnAt: now().toISOString() })
    return true
  }, [now, repository, today])

  const startCatchUp = useCallback(() => act(async () => {
    if (!active || dateMovedOn()) return
    const opened = await drawCatchUpFor(active.challenge, activeCatchUps)
    setLedger(await repository.readLedger())
    setCatchUpOpen(opened)
  }), [act, active, activeCatchUps, dateMovedOn, drawCatchUpFor, repository])

  const confirmCatchUp = useCallback(() => act(async () => {
    if (!active || !currentCatchUp || dateMovedOn()) return
    const confirmed: CatchUpEntry = { ...currentCatchUp, status: 'confirmed', confirmedAt: now().toISOString() }
    const others = activeCatchUps.filter((entry) => entry.date !== confirmed.date)
    const next = rebalanceUpcoming(active.challenge, today, [...others, confirmed], randomId())
    await repository.saveChallengeWithCatchUp(next, confirmed)
    replaceChallenge(next)
    const afterConfirm = (await repository.readLedger()).catchUps.filter((entry) => entry.challengeId === active.id)
    const continues = await drawCatchUpFor(next, afterConfirm)
    setLedger(await repository.readLedger())
    setCatchUpOpen(continues)
    setFeedback({ tone: 'success', message: { kind: 'catch-up-confirmed' } })
  }), [act, active, activeCatchUps, currentCatchUp, dateMovedOn, drawCatchUpFor, now, replaceChallenge, repository, today])

  const pauseCatchUp = useCallback(() => setCatchUpOpen(false), [])

  // ---- Penalty pot: the person confirms a payment they made themselves. The app never pays. -------------------
  const payPenalty = useCallback((challengeId: string, amountOre: number) => act(async () => {
    await repository.recordPenaltyPayment(challengeId, amountOre)
    setLedger(await repository.readLedger())
    setFeedback({ tone: 'success', message: { kind: 'penalty-paid' } })
  }), [act, repository])

  return {
    ledger,
    activeCatchUps,
    shock: shock ? { amount: shock.amount, minimumSek: shock.range.minimumSek, maximumSek: shock.range.maximumSek } : null,
    drawShockAgain,
    acceptShock,
    catchUp: {
      open: catchUpOpen,
      pending: pendingCatchUps.length,
      date: currentCatchUpDate,
      amount: currentCatchUp?.amount ?? null,
      position: confirmedCatchUps + 1,
      total: confirmedCatchUps + pendingCatchUps.length,
      started: hasDrawnCatchUp,
      noRoom: catchUpNoRoom,
    },
    startCatchUp,
    confirmCatchUp,
    pauseCatchUp,
    payPenalty,
    phase,
    today,
    items,
    active,
    notice,
    feedback,
    persisted,
    draw,
    confirm,
    createNewChallenge,
    switchChallenge,
    renameChallenge,
    exportBackup,
    exportRawData,
    inspectBackup,
    importBackup,
    skipDamagedData,
    retry,
    dismissNotice: () => setNotice(null),
    dismissFeedback: () => setFeedback(null),
    showError: fail,
  }
}

export type SavingsApp = ReturnType<typeof useSavingsApp>
