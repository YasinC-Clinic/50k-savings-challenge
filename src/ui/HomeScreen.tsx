import { useState } from 'react'
import { getDashboard, type DashboardView } from '../app/savings-view'
import type { ChallengeItem } from '../app/use-savings-app'
import type { ChallengeDay } from '../domain/challenge'
import { ConfirmDialog } from './ConfirmDialog'
import { formatDate, formatDayLong, formatRange, sek } from './format'
import { challengeStatusLabel, challengeTitle, planNotice, type Notice } from './sv'

interface HomeScreenProps {
  item: ChallengeItem
  today: string
  recovery: Notice | null
  onDismissRecovery: () => void
  onDraw: () => void
  onConfirm: () => void
  onOpenChallenges: () => void
}

export function NoticeCard({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  return (
    <section className={`notice ${notice.tone}`} role={notice.tone === 'info' ? 'status' : 'alert'}>
      <div>
        <b>{notice.title}</b>
        <p>{notice.body}</p>
      </div>
      {onDismiss && (
        <button type="button" className="icon-button" onClick={onDismiss} aria-label="Stäng meddelandet">
          ×
        </button>
      )}
    </section>
  )
}

export function HomeScreen({ item, today, recovery, onDismissRecovery, onDraw, onConfirm, onOpenChallenges }: HomeScreenProps) {
  const [confirming, setConfirming] = useState(false)
  const { challenge } = item
  const dashboard = getDashboard(challenge, today)
  const todayEntry = challenge.days.find((day) => day.date === today) ?? null
  const plan = planNotice(dashboard.plan, challenge.config)

  return (
    <>
      <section className="challenge-intro" aria-label="Aktiv utmaning">
        <p className="eyebrow">
          <span className="status-dot" /> Aktiv utmaning · {challengeStatusLabel[dashboard.status]}
        </p>
        <h1 className="challenge-title">{challengeTitle(item.name, challenge.config)}</h1>
        <p className="challenge-dates">
          {formatRange(dashboard.startDate, dashboard.endDate)} · {dashboard.totalDays} dagar
        </p>
        <button type="button" className="link-button" onClick={onOpenChallenges}>
          Byt eller skapa utmaning
        </button>
      </section>

      <Progress dashboard={dashboard} />
      <Balance dashboard={dashboard} />

      {recovery && <NoticeCard notice={recovery} onDismiss={onDismissRecovery} />}
      {plan && <NoticeCard notice={plan} />}

      <DailyCard
        dashboard={dashboard}
        today={today}
        entry={todayEntry}
        onDraw={onDraw}
        onAskConfirm={() => setConfirming(true)}
      />

      {confirming && todayEntry && (
        <ConfirmDialog
          title="Bekräfta sparandet"
          confirmLabel="Ja, jag har sparat det"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            onConfirm()
          }}
        >
          <p>
            Har du flyttat <b>{sek(todayEntry.amount)}</b> till ditt sparande? Först när du bekräftar räknas beloppet som sparat, och
            det går inte att ångra.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

function Progress({ dashboard }: { dashboard: DashboardView }) {
  return (
    <section className="progress-section" aria-label="Sparande hittills">
      <div className="section-heading">
        <h2>Ditt sparande</h2>
        <span>{dashboard.progressPercent.toLocaleString('sv-SE')} %</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="Andel av målet som är sparat"
        aria-valuemin={0}
        aria-valuemax={dashboard.targetSek}
        aria-valuenow={dashboard.savedSek}
      >
        <span className="progress-fill" style={{ width: `${dashboard.progressPercent}%` }} />
      </div>
      <div className="progress-labels">
        <span>{sek(dashboard.savedSek)} sparat</span>
        <span>Mål {sek(dashboard.targetSek)}</span>
      </div>
    </section>
  )
}

function Balance({ dashboard }: { dashboard: DashboardView }) {
  return (
    <section className="balance-panel" aria-label="Sammanfattning">
      <p className="balance-label">Bekräftat sparat</p>
      <p className="balance-amount">{sek(dashboard.savedSek)}</p>
      <p className="balance-remaining">{sek(dashboard.remainingSek)} kvar att spara</p>
      {dashboard.pendingSek > 0 && (
        <p className="balance-pending">Draget men ännu inte bekräftat: {sek(dashboard.pendingSek)} (räknas inte som sparat)</p>
      )}
      <div className="balance-stats">
        <span>
          <b>{dashboard.confirmedDays}</b> {dashboard.confirmedDays === 1 ? 'bekräftad dag' : 'bekräftade dagar'}
        </span>
        <span>
          <b>{dashboard.daysRemaining}</b> {dashboard.daysRemaining === 1 ? 'dag kvar' : 'dagar kvar'}
        </span>
        <span>
          <b>{dashboard.missedDays}</b> {dashboard.missedDays === 1 ? 'missad' : 'missade'}
        </span>
      </div>
    </section>
  )
}

interface DailyCardProps {
  dashboard: DashboardView
  today: string
  entry: ChallengeDay | null
  onDraw: () => void
  onAskConfirm: () => void
}

function DailyCard({ dashboard, today, entry, onDraw, onAskConfirm }: DailyCardProps) {
  const label =
    dashboard.status === 'upcoming'
      ? 'KOMMANDE'
      : dashboard.status === 'finished'
        ? 'AVSLUTAD'
        : `DAG ${dashboard.dayNumber} AV ${dashboard.totalDays}`

  return (
    <section className="daily-card" aria-label="Dagens utmaning">
      <div className="daily-card-topline">
        <p>{dashboard.status === 'active' ? formatDayLong(today) : 'Dagens utmaning'}</p>
        <span>{label}</span>
      </div>
      {dashboard.status === 'upcoming' && (
        <>
          <h2>Din första dragning väntar</h2>
          <p className="daily-description">
            Utmaningen börjar {formatDate(dashboard.startDate)}. Dina belopp är förberedda men hålls dolda tills du drar dem.
          </p>
        </>
      )}
      {dashboard.status === 'finished' && (
        <>
          <h2>Tiden har gått ut</h2>
          <p className="daily-description">Historiken finns kvar. Slutdatumet flyttas aldrig automatiskt.</p>
        </>
      )}
      {dashboard.status === 'active' && entry?.status === 'undrawn' && (
        <>
          <h2>Dagens belopp väntar</h2>
          <p className="daily-description">Dra ett slumpmässigt belopp för idag. Kommande belopp förblir dolda.</p>
          <button type="button" className="draw-button" onClick={onDraw}>
            Dra dagens belopp <span aria-hidden="true">→</span>
          </button>
        </>
      )}
      {dashboard.status === 'active' && entry?.status === 'drawn' && (
        <>
          <p className="amount-label">Idag – inte bekräftat än</p>
          <p className="daily-amount">{sek(entry.amount)}</p>
          <p className="daily-description">
            Beloppet är fast. Det räknas som sparat först när du bekräftar att du har satt undan det.
          </p>
          <button type="button" className="draw-button confirm" onClick={onAskConfirm}>
            Jag har sparat beloppet <span aria-hidden="true">✓</span>
          </button>
        </>
      )}
      {dashboard.status === 'active' && entry?.status === 'confirmed' && (
        <>
          <p className="amount-label">Sparat idag</p>
          <p className="daily-amount">{sek(entry.amount)}</p>
          <p className="confirmed-copy">Bekräftat och registrerat.</p>
        </>
      )}
      {dashboard.status === 'active' && entry?.status === 'missed' && (
        <>
          <h2>Dagen missades</h2>
          <p className="daily-description">Missade dagar räknas inte som sparade. Planen för kommande dagar har räknats om om det var möjligt.</p>
        </>
      )}
    </section>
  )
}
