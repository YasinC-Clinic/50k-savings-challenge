import { useRef, useState } from 'react'
import { downloadTextFile } from '../app/download'
import type { ImportMode } from '../app/use-savings-app'
import type { BackupSummary } from '../persistence/savings-repository'
import { ImportDialog } from './ImportDialog'

interface SettingsScreenProps {
  today: string
  existingCount: number
  persisted: boolean | null
  onExportBackup: () => Promise<string | undefined>
  onExportRaw: () => Promise<string | undefined>
  inspectBackup: (text: string) => BackupSummary
  onImportBackup: (text: string, mode: ImportMode) => Promise<unknown>
  onError: (error: unknown) => void
}

interface PendingImport {
  text: string
  summary: BackupSummary
}

export function SettingsScreen({
  today,
  existingCount,
  persisted,
  onExportBackup,
  onExportRaw,
  inspectBackup,
  onImportBackup,
  onError,
}: SettingsScreenProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)

  const exportBackup = async () => {
    const text = await onExportBackup()
    if (text) downloadTextFile(`50k-sparande-sakerhetskopia-${today}.json`, text)
  }

  const exportRaw = async () => {
    const text = await onExportRaw()
    if (text) downloadTextFile(`50k-sparande-radata-${today}.json`, text)
  }

  const chooseFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      setPending({ text, summary: inspectBackup(text) })
    } catch (error) {
      onError(error)
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <section className="page-section">
      <p className="eyebrow">
        <span className="status-dot" /> Den här enheten
      </p>
      <h2 className="page-title">Inställningar</h2>

      <article className="settings-card">
        <h3>Säkerhetskopia</h3>
        <p>
          Säkerhetskopian innehåller alla dina utmaningar och alla dagar. Den innehåller inga konton eller uppgifter om enheten. Exportera
          regelbundet – webbläsaren kan rensa lagrad data.
        </p>
        <button type="button" className="secondary-button" onClick={() => void exportBackup()} disabled={existingCount === 0}>
          Exportera säkerhetskopia
        </button>
        <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}>
          Importera säkerhetskopia
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          aria-label="Välj säkerhetskopia"
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
        <p className="small-print">Du får alltid välja innan något importeras eller ersätts.</p>
      </article>

      <article className="settings-card">
        <h3>Lagring</h3>
        <dl>
          <div>
            <dt>Var finns datan?</dt>
            <dd>Bara på den här enheten</dd>
          </div>
          <div>
            <dt>Skyddad mot rensning</dt>
            <dd>{persisted === null ? 'Okänt' : persisted ? 'Ja' : 'Nej'}</dd>
          </div>
        </dl>
        <p>Ingen inloggning, inga konton och ingen molntjänst. Appen fungerar utan internet.</p>
      </article>

      <article className="settings-card">
        <h3>Installera på iPhone</h3>
        <p>Öppna sidan i Safari, tryck på Dela och välj ”Lägg till på hemskärmen”. Sedan öppnas den som en vanlig app, även offline.</p>
      </article>

      <article className="settings-card quiet">
        <h3>Avancerat</h3>
        <p>
          Rådata är en teknisk kopia av allt som ligger lagrat, utan kontroll. Den är avsedd för felsökning och kan kräva hjälp av någon med
          teknisk kunskap. Inget ändras eller raderas.
        </p>
        <button type="button" className="secondary-button" onClick={() => void exportRaw()}>
          Spara rådata
        </button>
      </article>

      {pending && (
        <ImportDialog
          summary={pending.summary}
          existingCount={existingCount}
          onCancel={() => setPending(null)}
          onExportCurrent={() => void exportBackup()}
          onImport={async (mode) => {
            const done = await onImportBackup(pending.text, mode)
            if (done) setPending(null)
          }}
        />
      )}
    </section>
  )
}
