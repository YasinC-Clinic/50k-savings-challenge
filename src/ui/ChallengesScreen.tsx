import { useState } from 'react'
import { getDashboard } from '../app/savings-view'
import type { ChallengeItem, NewChallengeInput } from '../app/use-savings-app'
import { CreateChallengeForm } from './CreateChallengeForm'
import { formatRange, plural, sek } from './format'
import { challengeStatusLabel, challengeTitle, originLabel } from './sv'

interface ChallengesScreenProps {
  items: ChallengeItem[]
  activeId: string | null
  today: string
  onSwitch: (id: string) => void
  onCreate: (input: NewChallengeInput) => Promise<unknown>
  onRename: (id: string, name: string) => void
}

export function ChallengesScreen({ items, activeId, today, onSwitch, onCreate, onRename }: ChallengesScreenProps) {
  const [creating, setCreating] = useState(false)
  const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const isFinished = (item: ChallengeItem) => getDashboard(item.challenge, today).status === 'finished'
  const current = sorted.filter((item) => !isFinished(item))
  const history = sorted.filter(isFinished)

  return (
    <section className="page-section">
      <p className="eyebrow">
        <span className="status-dot" /> Dina utmaningar
      </p>
      <h2 className="page-title">Utmaningar</h2>
      <p className="page-intro">Varje utmaning är helt separat. Om du skapar en ny behålls alla andra med allt sparande.</p>

      {creating ? (
        <article className="settings-card">
          <h3>Ny utmaning</h3>
          <CreateChallengeForm
            today={today}
            existingCount={items.length}
            submitLabel="Skapa utmaning"
            onCancel={() => setCreating(false)}
            onSubmit={async (input) => {
              const created = await onCreate(input)
              if (created) setCreating(false)
            }}
          />
        </article>
      ) : (
        <button type="button" className="draw-button" onClick={() => setCreating(true)}>
          Ny utmaning <span aria-hidden="true">+</span>
        </button>
      )}

      <ChallengeList title="Pågående och kommande" items={current} activeId={activeId} today={today} onSwitch={onSwitch} onRename={onRename} />
      <ChallengeList title="Avslutade (historik)" items={history} activeId={activeId} today={today} onSwitch={onSwitch} onRename={onRename} />
    </section>
  )
}

interface ChallengeListProps {
  title: string
  items: ChallengeItem[]
  activeId: string | null
  today: string
  onSwitch: (id: string) => void
  onRename: (id: string, name: string) => void
}

function ChallengeList({ title, items, activeId, today, onSwitch, onRename }: ChallengeListProps) {
  if (items.length === 0) return null
  return (
    <>
      <h3 className="list-heading">{title}</h3>
      <ul className="challenge-list">
        {items.map((item) => (
          <ChallengeCard key={item.id} item={item} today={today} isActive={item.id === activeId} onSwitch={onSwitch} onRename={onRename} />
        ))}
      </ul>
    </>
  )
}

interface ChallengeCardProps {
  item: ChallengeItem
  today: string
  isActive: boolean
  onSwitch: (id: string) => void
  onRename: (id: string, name: string) => void
}

function ChallengeCard({ item, today, isActive, onSwitch, onRename }: ChallengeCardProps) {
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(item.name ?? '')
  const dashboard = getDashboard(item.challenge, today)
  const title = challengeTitle(item.name, item.challenge.config)
  const origin = originLabel(item.origin)

  return (
    <li className={`challenge-card${isActive ? ' active' : ''}`}>
      <div className="card-row">
        <h4>{title}</h4>
        <span className="pill">{challengeStatusLabel[dashboard.status]}</span>
      </div>
      <div className="badges">
        {isActive && <span className="badge active-badge">Aktiv</span>}
        {origin && <span className="badge">{origin}</span>}
      </div>
      <p className="card-meta">
        {formatRange(dashboard.startDate, dashboard.endDate)} · {dashboard.totalDays} dagar
      </p>
      <div className="progress-track small" aria-hidden="true">
        <span className="progress-fill" style={{ width: `${dashboard.progressPercent}%` }} />
      </div>
      <p className="card-meta">
        <b>{sek(dashboard.savedSek)}</b> sparat av {sek(dashboard.targetSek)} · {plural(dashboard.confirmedDays, 'bekräftad dag', 'bekräftade dagar')}
      </p>

      {renaming ? (
        <form
          className="rename-row"
          onSubmit={(event) => {
            event.preventDefault()
            onRename(item.id, draftName)
            setRenaming(false)
          }}
        >
          <label className="visually-hidden" htmlFor={`rename-${item.id}`}>
            Nytt namn
          </label>
          <input id={`rename-${item.id}`} value={draftName} maxLength={60} onChange={(event) => setDraftName(event.target.value)} />
          <button type="submit" className="secondary-button compact">
            Spara
          </button>
          <button type="button" className="link-button" onClick={() => setRenaming(false)}>
            Avbryt
          </button>
        </form>
      ) : (
        <div className="card-actions">
          {!isActive && (
            <button type="button" className="secondary-button compact" onClick={() => onSwitch(item.id)}>
              Gör aktiv
            </button>
          )}
          <button type="button" className="link-button" onClick={() => setRenaming(true)}>
            Byt namn
          </button>
        </div>
      )}
    </li>
  )
}

