import { getMonthlyHistory } from '../app/savings-view'
import type { ChallengeItem } from '../app/use-savings-app'
import { challengeTitle, dayStatusLabel } from '../i18n/describe'
import { useI18n } from '../i18n/LanguageProvider'
import { weekdayIndex } from './format'

export function CalendarScreen({ item, today }: { item: ChallengeItem | null; today: string }) {
  const i18n = useI18n()
  const { t, fmt } = i18n

  if (!item) {
    return (
      <section className="page-section">
        <h2 className="page-title">{t.calendar.emptyTitle}</h2>
        <p className="page-intro">{t.calendar.emptyIntro}</p>
      </section>
    )
  }

  const history = getMonthlyHistory(item.challenge, fmt.monthYear)
  return (
    <section className="page-section">
      <p className="eyebrow">
        <span className="status-dot" /> {challengeTitle(item.name, item.challenge.config, i18n)}
      </p>
      <h2 className="page-title">{t.calendar.heading}</h2>
      <p className="page-intro">{t.calendar.intro}</p>
      <div className="legend" aria-label={t.calendar.legendLabel}>
        <span className="confirmed-dot" /> {t.calendar.legend.confirmed} <span className="drawn-dot" /> {t.calendar.legend.drawn}{' '}
        <span className="missed-dot" /> {t.calendar.legend.missed}
      </div>
      {history.map((month) => (
        <article className="month" key={month.key}>
          <header>
            <div>
              <h3>{month.label}</h3>
              <p>{t.calendar.monthConfirmed(fmt.sek(month.confirmedSek))}</p>
            </div>
          </header>
          <div className="weekdays" aria-hidden="true">
            {t.calendar.weekdays.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          <div className="day-grid">
            {Array.from({ length: weekdayIndex(month.entries[0].date) }, (_, index) => (
              <div className="day empty" key={`empty-${index}`} aria-hidden="true" />
            ))}
            {month.entries.map((entry) => (
              <div
                className={`day ${entry.status}${entry.date === today ? ' today' : ''}`}
                key={entry.date}
                aria-label={t.calendar.dayLabel(entry.date, dayStatusLabel(entry.status, i18n), entry.amount === null ? null : fmt.sek(entry.amount))}
              >
                <span>{Number(entry.date.slice(-2))}</span>
                <b>{entry.amount === null ? '–' : fmt.sek(entry.amount)}</b>
                <small>{entry.status === 'undrawn' ? '' : dayStatusLabel(entry.status, i18n)}</small>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  )
}
