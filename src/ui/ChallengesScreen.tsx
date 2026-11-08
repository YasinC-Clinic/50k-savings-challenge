import { useState } from 'react'
import { getDashboard } from '../app/savings-view'
import type { ChallengeItem, NewChallengeInput } from '../app/use-savings-app'
import { challengeStatusLabel, challengeTitle, originLabel } from '../i18n/describe'
import { useI18n } from '../i18n/LanguageProvider'
import { CreateChallengeForm } from './CreateChallengeForm'

interface ChallengesScreenProps {
  items: ChallengeItem[]
  activeId: string | null
  today: string
  onSwitch: (id: string) => void
  onCreate: (input: NewChallengeInput) => Promise<unknown>
  onRename: (id: string, name: string) => void
}

export function ChallengesScreen({ items, activeId, today, onSwitch, onCreate, onRename }: ChallengesScreenProps) {
  const { t } = useI18n()
  const [creating, setCreating] = useState(false)
  const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const isFinished = (item: ChallengeItem) => getDashboard(item.challenge, today).status === 'finished'
  const current = sorted.filter((item) => !isFinished(item))
  const history = sorted.filter(isFinished)

  return (
    <section className="page-section">
      <p className="eyebrow">
        <span className="status-dot" /> {t.challenges.eyebrow}
      </p>
      <h2 className="page-title">{t.challenges.title}</h2>
      <p className="page-intro">{t.challenges.intro}</p>

      {creating ? (
        <article className="settings-card">
          <h3>{t.challenges.newTitle}</h3>
          <CreateChallengeForm
            today={today}
            existingCount={items.length}
            submitLabel={t.challenges.create}
            onCancel={() => setCreating(false)}
            onSubmit={async (input) => {
              const created = await onCreate(input)
              if (created) setCreating(false)
            }}
          />
        </article>
      ) : (
        <button type="button" className="draw-button" onClick={() => setCreating(true)}>
          {t.challenges.newButton} <span aria-hidden="true">+</span>
        </button>
      )}

      <ChallengeList title={t.challenges.current} items={current} activeId={activeId} today={today} onSwitch={onSwitch} onRename={onRename} />
      <ChallengeList title={t.challenges.history} items={history} activeId={activeId} today={today} onSwitch={onSwitch} onRename={onRename} />
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
  const i18n = useI18n()
  const { t, fmt } = i18n
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(item.name ?? '')
  const dashboard = getDashboard(item.challenge, today)
  const title = challengeTitle(item.name, item.challenge.config, i18n)
  const origin = originLabel(item.origin, i18n)

  return (
    <li className={`challenge-card${isActive ? ' active' : ''}`}>
      <div className="card-row">
        <h4>{title}</h4>
        <span className="pill">{challengeStatusLabel(dashboard.status, i18n)}</span>
      </div>
      <div className="badges">
        {isActive && <span className="badge active-badge">{t.challenges.active}</span>}
        {origin && <span className="badge">{origin}</span>}
      </div>
      <p className="card-meta">{t.challenges.meta(fmt.range(dashboard.startDate, dashboard.endDate), t.units.days(dashboard.totalDays))}</p>
      <div className="progress-track small" aria-hidden="true">
        <span className="progress-fill" style={{ width: `${dashboard.progressPercent}%` }} />
      </div>
      <p className="card-meta">
        <b>{fmt.sek(dashboard.savedSek)}</b>
        {t.challenges.savedOf(fmt.sek(dashboard.targetSek), t.challenges.confirmedDaysCount(dashboard.confirmedDays))}
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
            {t.challenges.newName}
          </label>
          <input id={`rename-${item.id}`} value={draftName} maxLength={60} onChange={(event) => setDraftName(event.target.value)} />
          <button type="submit" className="secondary-button compact">
            {t.common.save}
          </button>
          <button type="button" className="link-button" onClick={() => setRenaming(false)}>
            {t.common.cancel}
          </button>
        </form>
      ) : (
        <div className="card-actions">
          {!isActive && (
            <button type="button" className="secondary-button compact" onClick={() => onSwitch(item.id)}>
              {t.challenges.makeActive}
            </button>
          )}
          <button type="button" className="link-button" onClick={() => setRenaming(true)}>
            {t.challenges.rename}
          </button>
        </div>
      )}
    </li>
  )
}
