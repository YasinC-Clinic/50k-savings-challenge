import { useState } from 'react'
import { createAppServices, useSavingsApp, type AppServices } from './app/use-savings-app'
import { feedbackText } from './i18n/describe'
import { LanguageProvider, useI18n } from './i18n/LanguageProvider'
import { CalendarScreen } from './ui/CalendarScreen'
import { ChallengesScreen } from './ui/ChallengesScreen'
import { HomeScreen } from './ui/HomeScreen'
import { Onboarding } from './ui/Onboarding'
import { OutdatedScreen, RecoveryScreen, StorageProblemScreen } from './ui/RecoveryScreen'
import { SettingsScreen } from './ui/SettingsScreen'
import './App.css'
import './ui/screens.css'

type Tab = 'home' | 'calendar' | 'challenges' | 'settings'

const TAB_ICONS: Array<{ id: Tab; icon: string }> = [
  { id: 'home', icon: '⌂' },
  { id: 'calendar', icon: '▦' },
  { id: 'challenges', icon: '☰' },
  { id: 'settings', icon: '⚙' },
]

interface AppProps {
  /** Replaced in tests to use an isolated database and a controllable clock. */
  services?: AppServices
}

/** The language provider wraps everything, including the recovery screens that appear when the data cannot be opened. */
function App({ services }: AppProps) {
  return (
    <LanguageProvider>
      <AppContent services={services} />
    </LanguageProvider>
  )
}

function AppContent({ services }: AppProps) {
  const i18n = useI18n()
  const { t } = i18n
  const [resolvedServices] = useState(() => services ?? createAppServices())
  const app = useSavingsApp(resolvedServices)
  const [tab, setTab] = useState<Tab>('home')
  const visibleError = app.feedback?.tone === 'error' ? feedbackText(app.feedback.message, i18n) : undefined

  switch (app.phase.kind) {
    case 'loading':
      return (
        <main className="app-shell loading-state">
          <span className="loading-mark">S</span>
          <p>{t.app.loading}</p>
        </main>
      )
    case 'legacy-damaged':
      return <RecoveryScreen today={app.today} error={visibleError} onExportRaw={app.exportRawData} onSkip={app.skipDamagedData} />
    case 'storage-problem':
      return (
        <StorageProblemScreen
          today={app.today}
          problem={app.phase.error}
          error={visibleError}
          onExportRaw={app.exportRawData}
          onRetry={app.retry}
        />
      )
    case 'outdated':
      return <OutdatedScreen />
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#idag" onClick={() => setTab('home')}>
          <span className="wordmark-mark">S</span>
          <span>{t.app.brand}</span>
        </a>
        <span className="local-badge">{t.app.privateBadge}</span>
      </header>

      {app.feedback && (
        <div className={`message ${app.feedback.tone}`} role={app.feedback.tone === 'error' ? 'alert' : 'status'}>
          <span>{feedbackText(app.feedback.message, i18n)}</span>
          <button type="button" onClick={app.dismissFeedback} aria-label={t.app.dismiss}>
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

      <nav className="bottom-nav" aria-label={t.app.navLabel}>
        {TAB_ICONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tab === entry.id ? 'active' : ''}
            aria-current={tab === entry.id ? 'page' : undefined}
            onClick={() => setTab(entry.id)}
          >
            <span aria-hidden="true">{entry.icon}</span>
            {t.app.tabs[entry.id]}
          </button>
        ))}
      </nav>
    </main>
  )
}

export default App
