import { useState } from 'react'
import type { BackupSummary } from '../persistence/savings-repository'
import type { ImportMode } from '../app/use-savings-app'
import { formatRange, sek } from './format'

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
        <h2 id="import-title">Importera säkerhetskopia</h2>
        <p>
          Filen är giltig och innehåller {summary.challengeCount} {summary.challengeCount === 1 ? 'utmaning' : 'utmaningar'}:
        </p>
        <ul className="import-list">
          {summary.challenges.map((challenge, index) => (
            <li key={index}>
              <b>{challenge.name ?? `Utmaning ${sek(challenge.targetSek)}`}</b>
              <span>{formatRange(challenge.startDate, challenge.endDate)}</span>
              <span>
                {sek(challenge.savedSek)} sparat av {sek(challenge.targetSek)}
              </span>
            </li>
          ))}
        </ul>

        {summary.version === 1 && (
          <p className="callout">
            Det här är en säkerhetskopia från en äldre version av appen. Den läggs till som en <b>ny, separat utmaning</b>. Inget på den här
            enheten ersätts.
          </p>
        )}

        {summary.version === 2 && (
          <fieldset className="choice-group">
            <legend>Hur vill du importera?</legend>
            <label className="choice">
              <input type="radio" name="import-mode" checked={!replacing} onChange={() => setMode('import-as-new')} />
              <span>
                <b>Lägg till som nya utmaningar</b>
                <small>Rekommenderas. Dina nuvarande utmaningar behålls helt oförändrade.</small>
              </span>
            </label>
            {canReplace && (
              <label className="choice">
                <input type="radio" name="import-mode" checked={replacing} onChange={() => setMode('replace')} />
                <span>
                  <b>Ersätt allt på den här enheten</b>
                  <small>
                    Alla {existingCount} nuvarande {existingCount === 1 ? 'utmaning' : 'utmaningar'} tas bort och ersätts av filens innehåll.
                  </small>
                </span>
              </label>
            )}
          </fieldset>
        )}

        {replacing && (
          <div className="callout danger">
            <p>
              <b>Varning:</b> Det här tar bort allt sparande som finns på enheten nu. Det går inte att ångra utan en säkerhetskopia.
            </p>
            <button type="button" className="secondary-button compact" onClick={onExportCurrent}>
              Exportera nuvarande data först
            </button>
            <label className="checkbox-row">
              <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
              <span>Jag förstår att alla nuvarande utmaningar ersätts.</span>
            </label>
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            Avbryt
          </button>
          <button
            type="button"
            className={replacing ? 'danger-button solid' : 'draw-button'}
            disabled={busy || (replacing && !understood)}
            onClick={() => void submit()}
          >
            {replacing ? 'Ersätt allt' : 'Importera som ny'}
          </button>
        </div>
      </div>
    </div>
  )
}
