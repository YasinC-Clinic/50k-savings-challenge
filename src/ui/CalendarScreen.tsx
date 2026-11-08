import { getMonthlyHistory } from '../app/savings-view'
import type { ChallengeItem } from '../app/use-savings-app'
import { sek, weekdayIndex } from './format'
import { challengeTitle, dayStatusLabel } from './sv'

const WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör', 'Sön']

export function CalendarScreen({ item, today }: { item: ChallengeItem | null; today: string }) {
  if (!item) {
    return (
      <section className="page-section">
        <h2 className="page-title">Kalender</h2>
        <p className="page-intro">Skapa en utmaning för att se din kalender.</p>
      </section>
    )
  }

  const history = getMonthlyHistory(item.challenge)
  return (
    <section className="page-section">
      <p className="eyebrow">
        <span className="status-dot" /> {challengeTitle(item.name, item.challenge.config)}
      </p>
      <h2 className="page-title">Kalender och historik</h2>
      <p className="page-intro">Ett belopp syns först när dagen är dragen, bekräftad eller missad.</p>
      <div className="legend" aria-label="Förklaring">
        <span className="confirmed-dot" /> Bekräftad <span className="drawn-dot" /> Dragen, ej bekräftad <span className="missed-dot" /> Missad
      </div>
      {history.map((month) => (
        <article className="month" key={month.key}>
          <header>
            <div>
              <h3>{month.label}</h3>
              <p>{sek(month.confirmedSek)} bekräftat sparat</p>
            </div>
          </header>
          <div className="weekdays" aria-hidden="true">
            {WEEKDAYS.map((name) => (
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
                aria-label={`${entry.date}: ${dayStatusLabel[entry.status]}${entry.amount === null ? '' : `, ${sek(entry.amount)}`}`}
              >
                <span>{Number(entry.date.slice(-2))}</span>
                <b>{entry.amount === null ? '–' : sek(entry.amount)}</b>
                <small>{entry.status === 'undrawn' ? '' : dayStatusLabel[entry.status]}</small>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  )
}
