import { useState } from 'react'
import { downloadTextFile } from '../app/download'
import { errorMessage } from '../i18n/describe'
import { useI18n } from '../i18n/LanguageProvider'
import { ConfirmDialog } from './ConfirmDialog'

interface RecoveryScreenProps {
  today: string
  /** The latest error text, if any: these screens have no other place to show it. */
  error?: string
  onExportRaw: () => Promise<string | undefined>
  onSkip: () => Promise<unknown>
}

function ErrorLine({ error }: { error?: string }) {
  if (!error) return null
  return (
    <p className="field-error" role="alert">
      {error}
    </p>
  )
}

/**
 * Blocks the app when the data of the previous version cannot be read.
 * Nothing is changed or deleted here: the user first saves a raw copy, then explicitly chooses to continue.
 */
export function RecoveryScreen({ today, error, onExportRaw, onSkip }: RecoveryScreenProps) {
  const { t } = useI18n()
  const r = t.recovery
  const [exported, setExported] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const exportRaw = async () => {
    const text = await onExportRaw()
    if (!text) return
    downloadTextFile(t.files.raw(today), text)
    setExported(true)
  }

  return (
    <main className="app-shell">
      <section className="page-section">
        <p className="eyebrow">
          <span className="status-dot warning" /> {r.eyebrow}
        </p>
        <h1 className="challenge-title">{r.title}</h1>
        <p className="page-intro">
          {r.introBefore}
          <b>{r.introBold}</b>
        </p>
        <ErrorLine error={error} />

        <article className="settings-card">
          <h3>{r.step1Title}</h3>
          <p>{r.step1Body}</p>
          <button type="button" className="draw-button" onClick={() => void exportRaw()}>
            {r.saveRaw}
          </button>
          {exported && <p className="confirmed-copy">{r.saved}</p>}
        </article>

        <article className="settings-card">
          <h3>{r.step2Title}</h3>
          <p>{r.step2Body}</p>
          <button type="button" className="danger-button" onClick={() => setConfirming(true)}>
            {r.continue}
          </button>
        </article>
      </section>

      {confirming && (
        <ConfirmDialog
          title={r.dialogTitle}
          confirmLabel={r.dialogConfirm}
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            void onSkip()
          }}
        >
          <p>
            {r.dialogBefore}
            <b>{r.dialogBold}</b>
            {r.dialogAfter}
          </p>
          {!exported && <p>{r.dialogNoCopy}</p>}
        </ConfirmDialog>
      )}
    </main>
  )
}

interface StorageProblemScreenProps {
  today: string
  /** What went wrong; described in the current language. */
  problem: unknown
  error?: string
  onExportRaw: () => Promise<string | undefined>
  onRetry: () => void
}

/** The stored data could not be used for another reason. Nothing is changed; a raw copy can still be saved. */
export function StorageProblemScreen({ today, problem, error, onExportRaw, onRetry }: StorageProblemScreenProps) {
  const i18n = useI18n()
  const { t } = i18n
  const exportRaw = async () => {
    const text = await onExportRaw()
    if (text) downloadTextFile(t.files.raw(today), text)
  }

  return (
    <main className="app-shell">
      <section className="page-section">
        <p className="eyebrow">
          <span className="status-dot warning" /> {t.storageProblem.eyebrow}
        </p>
        <h1 className="challenge-title">{t.storageProblem.title}</h1>
        <p className="page-intro" role="alert">
          {errorMessage(problem, i18n)}
        </p>
        <article className="settings-card">
          <p>{t.storageProblem.body}</p>
          <button type="button" className="draw-button" onClick={onRetry}>
            {t.storageProblem.retry}
          </button>
          <button type="button" className="secondary-button" onClick={() => void exportRaw()}>
            {t.storageProblem.saveRaw}
          </button>
          <ErrorLine error={error} />
        </article>
      </section>
    </main>
  )
}

/** A newer copy of the app has upgraded the stored data. Writing from this older copy could damage it. */
export function OutdatedScreen() {
  const { t } = useI18n()
  return (
    <main className="app-shell">
      <section className="page-section">
        <p className="eyebrow">
          <span className="status-dot warning" /> {t.outdated.eyebrow}
        </p>
        <h1 className="challenge-title">{t.outdated.title}</h1>
        <p className="page-intro">{t.outdated.body}</p>
        <button type="button" className="draw-button" onClick={() => window.location.reload()}>
          {t.outdated.reload}
        </button>
      </section>
    </main>
  )
}
