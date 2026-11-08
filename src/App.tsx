import { useRef, useState } from 'react'
import { CHALLENGE } from './domain/challenge'
import { useSavingsChallenge } from './app/use-savings-challenge'
import './App.css'

type Tab = 'home' | 'calendar' | 'settings'
const sek = (amount: number) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }).format(amount)

function App() {
  const savings = useSavingsChallenge()
  const [tab, setTab] = useState<Tab>('home')
  const inputRef = useRef<HTMLInputElement>(null)
  const downloadBackup = async () => {
    const backup = await savings.exportBackup()
    if (!backup) return
    const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = `50k-savings-backup-${savings.today}.json`
    document.body.append(link); link.click(); link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  const importBackup = async (file: File | undefined) => {
    if (!file || !window.confirm('Replace this device’s current savings challenge with the selected backup? This cannot be undone.')) return
    try { await savings.restoreBackup(await file.text()) } finally { if (inputRef.current) inputRef.current.value = '' }
  }

  if (savings.loading) return <main className="app-shell loading-state"><span className="loading-mark">S</span><p>Preparing your private savings space…</p></main>
  if (!savings.challenge || !savings.dashboard) return <main className="app-shell loading-state"><p role="alert">{savings.error ?? 'Your challenge could not be loaded.'}</p></main>

  return <main className="app-shell">
    <header className="topbar"><a className="wordmark" href="#home" onClick={() => setTab('home')}><span className="wordmark-mark">S</span><span>spar</span></a><span className="local-badge">Private · on this device</span></header>
    {savings.error && <div className="message error" role="alert"><span>{savings.error}</span><button onClick={savings.clearMessage} aria-label="Dismiss">×</button></div>}
    {savings.notice && <div className="message success" role="status"><span>{savings.notice}</span><button onClick={savings.clearMessage} aria-label="Dismiss">×</button></div>}
    {tab === 'home' && <Home savings={savings} />}
    {tab === 'calendar' && <Calendar history={savings.history} />}
    {tab === 'settings' && <Settings onExport={downloadBackup} onImport={() => inputRef.current?.click()} />}
    <input ref={inputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importBackup(event.target.files?.[0])} />
    <nav className="bottom-nav" aria-label="Main navigation">
      <NavButton active={tab === 'home'} label="Home" icon="⌂" onClick={() => setTab('home')} />
      <NavButton active={tab === 'calendar'} label="Calendar" icon="□" onClick={() => setTab('calendar')} />
      <NavButton active={tab === 'settings'} label="Settings" icon="⚙" onClick={() => setTab('settings')} />
    </nav>
  </main>
}

function Home({ savings }: { savings: ReturnType<typeof useSavingsChallenge> }) {
  const { dashboard, todayEntry, recovery } = savings
  if (!dashboard) return null
  const upcoming = dashboard.status === 'upcoming'
  const finished = dashboard.status === 'finished'
  return <>
    <section className="challenge-intro" id="home"><p className="eyebrow"><span className="status-dot" /> {dashboard.status === 'active' ? 'Today’s practice' : dashboard.status === 'upcoming' ? 'Starts 1 January 2027' : 'Challenge complete'}</p><h1>50K <span>Challenge</span></h1><p className="challenge-dates">1 January — 30 June 2027 · {CHALLENGE.durationDays} days</p></section>
    <section className="progress-section" aria-label="Savings progress"><div className="section-heading"><h2>Your progress</h2><span>{dashboard.progressPercent}%</span></div><div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={CHALLENGE.targetSek} aria-valuenow={dashboard.savedSek}><span className="progress-fill" style={{ width: `${dashboard.progressPercent}%` }} /></div><div className="progress-labels"><span>{sek(dashboard.savedSek)} saved</span><span>{sek(CHALLENGE.targetSek)}</span></div></section>
    <section className="balance-panel"><p className="balance-label">Saved so far</p><p className="balance-amount">{sek(dashboard.savedSek)}</p><p className="balance-remaining">{sek(dashboard.remainingSek)} remaining</p><div className="balance-stats"><span><b>{dashboard.daysCompleted}</b> confirmed days</span><span><b>{dashboard.daysRemaining}</b> days remaining</span></div></section>
    {recovery && <section className={`recovery ${recovery.status}`}><b>{recovery.status === 'impossible' ? 'Recovery is no longer possible' : recovery.status === 'needs_higher_ceiling' ? 'Recovery plan updated' : 'Plan updated'}</b><p>{recovery.message}</p></section>}
    <section className="daily-card" aria-label="Today’s challenge">
      <div className="daily-card-topline"><p>Today’s challenge</p><span>{upcoming ? 'UPCOMING' : finished ? 'FINISHED' : `DAY ${CHALLENGE.durationDays - dashboard.daysRemaining + 1}`}</span></div>
      {upcoming ? <><h2>Your first draw awaits</h2><p className="daily-description">The challenge begins on 1 January 2027. Your amounts are safely prepared, but remain hidden.</p></> : finished ? <><h2>The deadline has passed</h2><p className="daily-description">Your history is preserved locally. The challenge was never extended automatically.</p></> : todayEntry?.status === 'undrawn' ? <><h2>Today’s amount is waiting</h2><p className="daily-description">Reveal one private, random saving amount. Future amounts stay hidden.</p><button className="draw-button" onClick={() => void savings.draw()}>Draw today’s amount <span>→</span></button></> : todayEntry?.status === 'drawn' ? <><p className="amount-label">Today, set aside</p><p className="daily-amount">{todayEntry.amount !== null ? sek(todayEntry.amount) : '—'}</p><p className="daily-description">This amount is fixed. Confirm only after you have saved it.</p><button className="draw-button confirm" onClick={() => void savings.confirm()}>I have saved this amount <span>✓</span></button></> : todayEntry?.status === 'confirmed' ? <><p className="amount-label">Saved today</p><p className="daily-amount">{todayEntry.amount !== null ? sek(todayEntry.amount) : '—'}</p><p className="confirmed-copy">Confirmed and safely recorded.</p></> : <><h2>Today was missed</h2><p className="daily-description">Your remaining undrawn amounts have been recalculated where possible.</p></>}
    </section>
  </>
}

function Calendar({ history }: { history: ReturnType<typeof useSavingsChallenge>['history'] }) {
  return <section className="page-section"><p className="eyebrow"><span className="status-dot" /> Challenge record</p><h2 className="page-title">Calendar & history</h2><p className="page-intro">Amounts are visible only after a day has been drawn, confirmed or missed.</p><div className="legend"><span className="confirmed-dot" /> Confirmed <span className="drawn-dot" /> Drawn <span className="missed-dot" /> Missed</div>{history.map((month) => <article className="month" key={month.key}><header><div><h3>{month.label}</h3><p>{sek(month.confirmedSek)} confirmed</p></div></header><div className="day-grid">{month.entries.map((entry) => <div className={`day ${entry.status}`} key={entry.date}><span>{entry.date.slice(-2)}</span><b>{entry.amount === null ? '—' : sek(entry.amount)}</b><small>{entry.status}</small></div>)}</div></article>)}</section>
}

function Settings({ onExport, onImport }: { onExport: () => void; onImport: () => void }) {
  return <section className="page-section"><p className="eyebrow"><span className="status-dot" /> Your device</p><h2 className="page-title">Settings</h2><article className="settings-card"><h3>Challenge details</h3><dl><div><dt>Goal</dt><dd>{sek(CHALLENGE.targetSek)}</dd></div><div><dt>Dates</dt><dd>1 Jan – 30 Jun 2027</dd></div><div><dt>Storage</dt><dd>Local to this device</dd></div></dl></article><article className="settings-card"><h3>Backup & restore</h3><p>Your backup contains your challenge and all daily records. It does not contain account or device information.</p><button className="secondary-button" onClick={onExport}>Export backup</button><button className="danger-button" onClick={onImport}>Import and replace backup</button></article><article className="settings-card quiet"><h3>About Spar</h3><p>Offline-first and private by design. Export a backup regularly—browser storage can be cleared by your device.</p></article></section>
}

function NavButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: string; onClick: () => void }) { return <button className={active ? 'active' : ''} onClick={onClick}><span aria-hidden="true">{icon}</span>{label}</button> }
export default App
