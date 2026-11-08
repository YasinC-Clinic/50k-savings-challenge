import { useState } from 'react'
import { getDashboard, type DashboardView } from '../app/savings-view'
import type { ChallengeItem, RecoveryNoticeData } from '../app/use-savings-app'
import type { ChallengeDay } from '../domain/challenge'
import { challengeStatusLabel, challengeTitle, planNotice, recoveryNotice, type Notice } from '../i18n/describe'
import { useI18n } from '../i18n/LanguageProvider'
import { ConfirmDialog } from './ConfirmDialog'

interface HomeScreenProps {
  item: ChallengeItem
  today: string
  recovery: RecoveryNoticeData | null
  onDismissRecovery: () => void
  onDraw: () => void
  onConfirm: () => void
  onOpenChallenges: () => void
}

export function NoticeCard({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  const { t } = useI18n()
  return (
    <section className={`notice ${notice.tone}`} role={notice.tone === 'info' ? 'status' : 'alert'}>
      <div>
        <b>{notice.title}</b>
        <p>{notice.body}</p>
      </div>
      {onDismiss && (
        <button type="button" className="icon-button" onClick={onDismiss} aria-label={t.home.dismissNotice}>
          ×
        </button>
      )}
    </section>
  )
}

export function HomeScreen({ item, today, recovery, onDismissRecovery, onDraw, onConfirm, onOpenChallenges }: HomeScreenProps) {
  const i18n = useI18n()
  const { t, fmt } = i18n
  const [confirming, setConfirming] = useState(false)
  const { challenge } = item
  const dashboard = getDashboard(challenge, today)
  const todayEntry = challenge.days.find((day) => day.date === today) ?? null
  const plan = planNotice(dashboard.plan, challenge.config, i18n)

  return (
    <>
      <section className="challenge-intro" aria-label={t.home.sectionLabel}>
        <p className="eyebrow">
          <span className="status-dot" /> {t.home.eyebrow(challengeStatusLabel(dashboard.status, i18n))}
        </p>
        <h1 className="challenge-title">{challengeTitle(item.name, challenge.config, i18n)}</h1>
        <p className="challenge-dates">{t.challenges.meta(fmt.range(dashboard.startDate, dashboard.endDate), t.units.days(dashboard.totalDays))}</p>
        <button type="button" className="link-button" onClick={onOpenChallenges}>
          {t.home.switchLink}
        </button>
      </section>

      <Progress dashboard={dashboard} />
      <Balance dashboard={dashboard} />

      {recovery && <NoticeCard notice={recoveryNotice(recovery.recovery, recovery.config, i18n)} onDismiss={onDismissRecovery} />}
      {plan && <NoticeCard notice={plan} />}

      <DailyCard dashboard={dashboard} today={today} entry={todayEntry} onDraw={onDraw} onAskConfirm={() => setConfirming(true)} />

      {confirming && todayEntry && (
        <ConfirmDialog
          title={t.home.confirmDialog.title}
          confirmLabel={t.home.confirmDialog.confirm}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            onConfirm()
          }}
        >
          <p>
            {t.home.confirmDialog.before}
            <b>{fmt.sek(todayEntry.amount)}</b>
            {t.home.confirmDialog.after}
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

function Progress({ dashboard }: { dashboard: DashboardView }) {
  const { t, fmt } = useI18n()
  return (
    <section className="progress-section" aria-label={t.home.progressLabel}>
      <div className="section-heading">
        <h2>{t.home.progressHeading}</h2>
        <span>{fmt.percent(dashboard.progressPercent)}</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={t.home.progressBar}
        aria-valuemin={0}
        aria-valuemax={dashboard.targetSek}
        aria-valuenow={dashboard.savedSek}
      >
        <span className="progress-fill" style={{ width: `${dashboard.progressPercent}%` }} />
      </div>
      <div className="progress-labels">
        <span>{t.home.savedSoFar(fmt.sek(dashboard.savedSek))}</span>
        <span>{t.home.goal(fmt.sek(dashboard.targetSek))}</span>
      </div>
    </section>
  )
}

function Balance({ dashboard }: { dashboard: DashboardView }) {
  const { t, fmt } = useI18n()
  return (
    <section className="balance-panel" aria-label={t.home.balanceLabel}>
      <p className="balance-label">{t.home.confirmedSaved}</p>
      <p className="balance-amount">{fmt.sek(dashboard.savedSek)}</p>
      <p className="balance-remaining">{t.home.remaining(fmt.sek(dashboard.remainingSek))}</p>
      {dashboard.pendingSek > 0 && <p className="balance-pending">{t.home.pending(fmt.sek(dashboard.pendingSek))}</p>}
      <div className="balance-stats">
        <span>
          <b>{dashboard.confirmedDays}</b> {t.home.confirmedDays(dashboard.confirmedDays)}
        </span>
        <span>
          <b>{dashboard.daysRemaining}</b> {t.home.daysLeft(dashboard.daysRemaining)}
        </span>
        <span>
          <b>{dashboard.missedDays}</b> {t.home.missed(dashboard.missedDays)}
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
  const { t, fmt } = useI18n()
  const daily = t.home.daily
  const label =
    dashboard.status === 'upcoming'
      ? daily.upcoming
      : dashboard.status === 'finished'
        ? daily.finished
        : daily.dayOf(dashboard.dayNumber ?? 0, dashboard.totalDays)

  return (
    <section className="daily-card" aria-label={daily.label}>
      <div className="daily-card-topline">
        <p>{dashboard.status === 'active' ? fmt.dayLong(today) : daily.label}</p>
        <span>{label}</span>
      </div>
      {dashboard.status === 'upcoming' && (
        <>
          <h2>{daily.upcomingTitle}</h2>
          <p className="daily-description">{daily.upcomingBody(fmt.date(dashboard.startDate))}</p>
        </>
      )}
      {dashboard.status === 'finished' && (
        <>
          <h2>{daily.finishedTitle}</h2>
          <p className="daily-description">{daily.finishedBody}</p>
        </>
      )}
      {dashboard.status === 'active' && entry?.status === 'undrawn' && (
        <>
          <h2>{daily.undrawnTitle}</h2>
          <p className="daily-description">{daily.undrawnBody}</p>
          <button type="button" className="draw-button" onClick={onDraw}>
            {daily.drawButton} <span aria-hidden="true">→</span>
          </button>
        </>
      )}
      {dashboard.status === 'active' && entry?.status === 'drawn' && (
        <>
          <p className="amount-label">{daily.drawnLabel}</p>
          <p className="daily-amount">{fmt.sek(entry.amount)}</p>
          <p className="daily-description">{daily.drawnBody}</p>
          <button type="button" className="draw-button confirm" onClick={onAskConfirm}>
            {daily.confirmButton} <span aria-hidden="true">✓</span>
          </button>
        </>
      )}
      {dashboard.status === 'active' && entry?.status === 'confirmed' && (
        <>
          <p className="amount-label">{daily.confirmedLabel}</p>
          <p className="daily-amount">{fmt.sek(entry.amount)}</p>
          <p className="confirmed-copy">{daily.confirmedCopy}</p>
        </>
      )}
      {dashboard.status === 'active' && entry?.status === 'missed' && (
        <>
          <h2>{daily.missedTitle}</h2>
          <p className="daily-description">{daily.missedBody}</p>
        </>
      )}
    </section>
  )
}
