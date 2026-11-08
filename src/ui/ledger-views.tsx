import { useState } from 'react'
import type { ChallengeItem, SavingsApp } from '../app/use-savings-app'
import { penaltyTotals, confirmedSavingsSek, isCompleted } from '../domain/ledger'
import { challengeTitle } from '../i18n/describe'
import { useI18n } from '../i18n/LanguageProvider'
import type { Ledger } from '../persistence/ledger'
import { ConfirmDialog } from './ConfirmDialog'

/** The lightning mark used by every Shock Day element. Decorative: the text next to it says everything. */
function Bolt() {
  return (
    <span className="bolt" aria-hidden="true">
      ⚡
    </span>
  )
}

interface ShockDayCardProps {
  shock: NonNullable<SavingsApp['shock']>
  onAccept: () => void
  onDrawAgain: () => void
}

/**
 * A Shock Day offers an unusually high amount. It is only a proposal: nothing is stored until the person accepts,
 * and drawing again is free (the app never shows the same amount twice in a row).
 */
export function ShockDayCard({ shock, onAccept, onDrawAgain }: ShockDayCardProps) {
  const { t, fmt } = useI18n()
  const text = t.ledger.shock
  return (
    <section className="daily-card shock-card" aria-label={text.badge}>
      <div className="daily-card-topline">
        <p>
          <Bolt /> {text.badge}
        </p>
      </div>
      <h2>{text.title}</h2>
      <p className="daily-description">{text.body(fmt.sek(shock.minimumSek), fmt.sek(shock.maximumSek))}</p>
      <p className="amount-label">{text.pendingLabel}</p>
      <p className="daily-amount shock-amount" aria-live="polite">
        {fmt.sek(shock.amount)}
      </p>
      <div className="shock-actions">
        <button type="button" className="draw-button shock-accept" onClick={onAccept}>
          {text.accept}
        </button>
        <button type="button" className="secondary-button shock-again" onClick={onDrawAgain}>
          {text.drawAgain}
        </button>
      </div>
      <p className="confirmed-copy">{text.note}</p>
    </section>
  )
}

interface CatchUpProps {
  catchUp: SavingsApp['catchUp']
}

export function CatchUpBanner({ catchUp, onStart }: CatchUpProps & { onStart: () => void }) {
  const { t } = useI18n()
  const text = t.ledger.catchUp
  if (catchUp.pending === 0) return null
  return (
    <section className="notice info catchup-banner" aria-label={text.dialogTitle}>
      <div>
        <b>
          <Bolt /> {text.bannerTitle(catchUp.pending)}
        </b>
        <p>{catchUp.noRoom ? text.noRoom : text.bannerBody}</p>
        {!catchUp.noRoom && (
          <button type="button" className="secondary-button compact" onClick={onStart}>
            {catchUp.started ? text.resume : text.start}
          </button>
        )}
      </div>
    </section>
  )
}

/** One missed day at a time. Pausing keeps the drawn amount; only confirming counts it as saved. */
export function CatchUpDialog({ catchUp, onConfirm, onPause }: CatchUpProps & { onConfirm: () => void; onPause: () => void }) {
  const { t, fmt } = useI18n()
  const text = t.ledger.catchUp
  if (!catchUp.open || !catchUp.date || catchUp.amount === null) return null
  return (
    <ConfirmDialog title={text.dialogTitle} confirmLabel={text.confirm} cancelLabel={text.pause} onCancel={onPause} onConfirm={onConfirm}>
      <p className="catchup-progress">{text.progress(catchUp.position, catchUp.total)}</p>
      <p>{text.forDate(fmt.date(catchUp.date))}</p>
      <p className="amount-label">{text.amountLabel}</p>
      <p className="daily-amount">{fmt.sek(catchUp.amount)}</p>
    </ConfirmDialog>
  )
}

interface PenaltyPotCardProps {
  ledger: Ledger
  items: ChallengeItem[]
  /** The compact form is only the total; the detailed one lists every challenge and allows confirming a payment. */
  detailed: boolean
  onPay?: (challengeId: string, amountOre: number) => void
}

/**
 * The permanent penalty pot: everything ever accrued across all challenges. It is information plus a manual
 * "I have paid" confirmation; the app never pays and never counts penalties as savings.
 */
export function PenaltyPotCard({ ledger, items, detailed, onPay }: PenaltyPotCardProps) {
  const i18n = useI18n()
  const { t, fmt } = i18n
  const text = t.ledger.penalty
  const [paying, setPaying] = useState<{ challengeId: string; outstandingOre: number } | null>(null)
  const total = penaltyTotals(ledger.penalties, ledger.payments)
  const ids = [...new Set([...items.map((item) => item.id), ...ledger.penalties.map((entry) => entry.challengeId)])]
  const rows = ids
    .map((id) => ({ id, item: items.find((candidate) => candidate.id === id) ?? null, totals: penaltyTotals(ledger.penalties, ledger.payments, id) }))
    .filter((row) => row.totals.accruedOre > 0)

  if (total.accruedOre === 0 && !detailed) return null

  return (
    <section className="pot-card" aria-label={text.potTitle}>
      <div className="section-heading">
        <h2>
          <Bolt /> {text.potTitle}
        </h2>
      </div>
      <p className="pot-intro">{text.potIntro}</p>
      <PotTotals accruedOre={total.accruedOre} paidOre={total.paidOre} outstandingOre={total.outstandingOre} />
      {detailed && total.accruedOre === 0 && <p className="pot-empty">{text.none}</p>}
      {detailed && rows.length > 0 && (
        <>
          <h3 className="pot-subheading">{text.perChallenge}</h3>
          <ul className="pot-list">
            {rows.map((row) => (
              <li key={row.id}>
                <b>{row.item ? challengeTitle(row.item.name, row.item.challenge.config, i18n) : text.removedChallenge}</b>
                <PotTotals {...row.totals} />
                {row.totals.outstandingOre > 0 && onPay && (
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => setPaying({ challengeId: row.id, outstandingOre: row.totals.outstandingOre })}
                  >
                    {text.markPaid}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {paying && onPay && (
        <ConfirmDialog
          title={text.markPaidTitle}
          confirmLabel={text.markPaidConfirm}
          onCancel={() => setPaying(null)}
          onConfirm={() => {
            onPay(paying.challengeId, paying.outstandingOre)
            setPaying(null)
          }}
        >
          <p>{text.markPaidBody(fmt.ore(paying.outstandingOre))}</p>
        </ConfirmDialog>
      )}
    </section>
  )
}

function PotTotals({ accruedOre, paidOre, outstandingOre }: { accruedOre: number; paidOre: number; outstandingOre: number }) {
  const { t, fmt } = useI18n()
  const text = t.ledger.penalty
  return (
    <dl className="pot-totals">
      <div>
        <dt>{text.accrued}</dt>
        <dd>{fmt.ore(accruedOre)}</dd>
      </div>
      <div>
        <dt>{text.paid}</dt>
        <dd>{fmt.ore(paidOre)}</dd>
      </div>
      <div>
        <dt>{text.outstanding}</dt>
        <dd>{fmt.ore(outstandingOre)}</dd>
      </div>
    </dl>
  )
}

/**
 * Shown when the target is reached or the challenge has ended. The savings target stays a savings target:
 * penalties appear next to it, and the combined line is information only.
 */
export function CompletionSummary({ item, ledger, finished }: { item: ChallengeItem; ledger: Ledger; finished: boolean }) {
  const { t, fmt } = useI18n()
  const text = t.ledger.summary
  const catchUps = ledger.catchUps.filter((entry) => entry.challengeId === item.id)
  const completed = isCompleted(item.challenge, catchUps)
  if (!completed && !finished) return null

  const saved = confirmedSavingsSek(item.challenge, catchUps)
  const own = penaltyTotals(ledger.penalties, ledger.payments, item.id)
  const pot = penaltyTotals(ledger.penalties, ledger.payments)
  const missed = item.challenge.days.filter((day) => day.status === 'missed').length
  const combinedOre = saved * 100 + own.accruedOre

  return (
    <section className="summary-card" aria-label={text.title}>
      <div className="section-heading">
        <h2>{text.title}</h2>
      </div>
      <dl className="pot-totals summary-list">
        <div>
          <dt>{text.target}</dt>
          <dd>{fmt.sek(item.challenge.config.targetSek)}</dd>
        </div>
        <div>
          <dt>{text.saved}</dt>
          <dd>{fmt.sek(saved)}</dd>
        </div>
        <div>
          <dt>{text.missedDays}</dt>
          <dd>{missed}</dd>
        </div>
        <div>
          <dt>{text.accrued}</dt>
          <dd>{fmt.ore(own.accruedOre)}</dd>
        </div>
        <div>
          <dt>{text.paid}</dt>
          <dd>{fmt.ore(own.paidOre)}</dd>
        </div>
        <div>
          <dt>{text.outstanding}</dt>
          <dd>{fmt.ore(own.outstandingOre)}</dd>
        </div>
        <div>
          <dt>{text.pot}</dt>
          <dd>{fmt.ore(pot.accruedOre)}</dd>
        </div>
      </dl>
      <h3 className="pot-subheading">{text.combinedTitle}</h3>
      <p className="pot-intro">{text.combinedBody(fmt.sek(saved), fmt.ore(own.accruedOre), fmt.ore(combinedOre))}</p>
    </section>
  )
}
