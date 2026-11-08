import { useState } from 'react'
import type { ImportMode } from '../app/use-savings-app'
import { useI18n } from '../i18n/LanguageProvider'
import type { BackupSummary } from '../persistence/savings-repository'

interface ImportDialogProps {
  summary: BackupSummary
  /** Number of challenges currently on this device. */
  existingCount: number
  onImport: (mode: ImportMode) => Promise<unknown>
  onCancel: () => void
  onExportCurrent: () => void
}

/** Explains exactly what an import will do before anything is changed. */
export function ImportDialog({ summary, existingCount, onImport, onCancel, onExportCurrent }: ImportDialogProps) {
  const { t, fmt } = useI18n()
  const d = t.importDialog
  const [mode, setMode] = useState<ImportMode>('import-as-new')
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const canReplace = summary.version === 2 && existingCount > 0
  const replacing = mode === 'replace'

  const submit = async () => {
    setBusy(true)
    try {
      await onImport(mode)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <h2 id="import-title">{d.title}</h2>
        <p>{d.valid(summary.challengeCount)}</p>
        <ul className="import-list">
          {summary.challenges.map((challenge, index) => (
            <li key={index}>
              <b>{challenge.name ?? t.status.unnamed(fmt.sek(challenge.targetSek))}</b>
              <span>{fmt.range(challenge.startDate, challenge.endDate)}</span>
              <span>{d.savedOf(fmt.sek(challenge.savedSek), fmt.sek(challenge.targetSek))}</span>
            </li>
          ))}
        </ul>

        {summary.version === 1 && (
          <p className="callout">
            {d.legacyBefore}
            <b>{d.legacyBold}</b>
            {d.legacyAfter}
          </p>
        )}

        {summary.version === 2 && (
          <fieldset className="choice-group">
            <legend>{d.howLegend}</legend>
            <label className="choice">
              <input type="radio" name="import-mode" checked={!replacing} onChange={() => setMode('import-as-new')} />
              <span>
                <b>{d.addTitle}</b>
                <small>{d.addDescription}</small>
              </span>
            </label>
            {canReplace && (
              <label className="choice">
                <input type="radio" name="import-mode" checked={replacing} onChange={() => setMode('replace')} />
                <span>
                  <b>{d.replaceTitle}</b>
                  <small>{d.replaceDescription(existingCount)}</small>
                </span>
              </label>
            )}
          </fieldset>
        )}

        {replacing && (
          <div className="callout danger">
            <p>
              <b>{d.warningLabel}</b>
              {d.warningText}
            </p>
            <button type="button" className="secondary-button compact" onClick={onExportCurrent}>
              {d.exportFirst}
            </button>
            <label className="checkbox-row">
              <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
              <span>{d.understand}</span>
            </label>
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            {d.cancel}
          </button>
          <button
            type="button"
            className={replacing ? 'danger-button solid' : 'draw-button'}
            disabled={busy || (replacing && !understood)}
            onClick={() => void submit()}
          >
            {replacing ? d.replaceAll : d.importAsNew}
          </button>
        </div>
      </div>
    </div>
  )
}
