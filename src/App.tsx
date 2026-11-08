import { useState } from 'react'
import { createAppServices, useSavingsApp, type AppServices } from './app/use-savings-app'
import { CalendarScreen } from './ui/CalendarScreen'
import { ChallengesScreen } from './ui/ChallengesScreen'
import { HomeScreen } from './ui/HomeScreen'
import { Onboarding } from './ui/Onboarding'
import { OutdatedScreen, RecoveryScreen, StorageProblemScreen } from './ui/RecoveryScreen'
import { SettingsScreen } from './ui/SettingsScreen'
import './App.css'
import './ui/screens.css'

type Tab = 'home' | 'calendar' | 'challenges' | 'settings'

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'home', label: 'Idag', icon: '⌂' },
  { id: 'calendar', label: 'Kalender', icon: '▦' },
  { id: 'challenges', label: 'Utmaningar', icon: '☰' },
  { id: 'settings', label: 'Inställningar', icon: '⚙' },
]

interface AppProps {
  /** Replaced in tests to use an isolated database and a controllable clock. */
  services?: AppServices
}

function App({ services }: AppProps) {
  const [resolvedServices] = useState(() => services ?? createAppServices())
  const app = useSavingsApp(resolvedServices)
  const [tab, setTab] = useState<Tab>('home')
  const visibleError = app.feedback?.tone === 'error' ? app.feedback.text : undefined

  switch (app.phase.kind) {
    case 'loading':
      return (
        <main className="app-shell loading-state">
          <span className="loading-mark">S</span>
          <p>Förbereder ditt sparande…</p>
        </main>
      )
    case 'legacy-damaged':
      return <RecoveryScreen today={app.today} error={visibleError} onExportRaw={app.exportRawData} onSkip={app.skipDamagedData} />
    case 'storage-problem':
      return <StorageProblemScreen today={app.today} message={app.phase.message} error={visibleError} onExportRaw={app.exportRawData} onRetry={app.retry} />
    case 'outdated':
      return <OutdatedScreen />
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#idag" onClick={() => setTab('home')}>
          <span className="wordmark-mark">S</span>
          <span>spar</span>
        </a>
        <span className="local-badge">Privat · på den här enheten</span>
      </header>

      {app.feedback && (
        <div className={`message ${app.feedback.tone}`} role={app.feedback.tone === 'error' ? 'alert' : 'status'}>
          <span>{app.feedback.text}</span>
          <button type="button" onClick={app.dismissFeedback} aria-label="Stäng meddelandet">
            ×
          </button>
        </div>
      )}

      {tab === 'home' &&
        (app.active ? (
          <HomeScreen
            item={app.active}
            today={app.today}
            recovery={app.notice}
            onDismissRecovery={app.dismissNotice}
            onDraw={() => void app.draw()}
            onConfirm={() => void app.confirm()}
            onOpenChallenges={() => setTab('challenges')}
          />
        ) : (
          <Onboarding
            today={app.today}
            onCreate={async (input) => {
              const created = await app.createNewChallenge(input)
              if (created) setTab('home')
              return created
            }}
          />
        ))}
      {tab === 'calendar' && <CalendarScreen item={app.active} today={app.today} />}
      {tab === 'challenges' && (
        <ChallengesScreen
          items={app.items}
          activeId={app.active?.id ?? null}
          today={app.today}
          onSwitch={(id) => void app.switchChallenge(id).then(() => setTab('home'))}
          onCreate={async (input) => {
            const created = await app.createNewChallenge(input)
            if (created) setTab('home')
            return created
          }}
          onRename={(id, name) => void app.renameChallenge(id, name)}
        />
      )}
      {tab === 'settings' && (
        <SettingsScreen
          today={app.today}
          existingCount={app.items.length}
          persisted={app.persisted}
          onExportBackup={app.exportBackup}
          onExportRaw={app.exportRawData}
          inspectBackup={app.inspectBackup}
          onImportBackup={app.importBackup}
          onError={app.showError}
        />
      )}

      <nav className="bottom-nav" aria-label="Huvudmeny">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tab === entry.id ? 'active' : ''}
            aria-current={tab === entry.id ? 'page' : undefined}
            onClick={() => setTab(entry.id)}
          >
            <span aria-hidden="true">{entry.icon}</span>
            {entry.label}
          </button>
        ))}
      </nav>
    </main>
  )
}

export default App
