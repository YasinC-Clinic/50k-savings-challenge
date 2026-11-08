import { useRef, useState } from 'react'
import { downloadTextFile } from '../app/download'
import type { ImportMode } from '../app/use-savings-app'
import { LANGUAGES, type Language } from '../i18n/language'
import { useI18n } from '../i18n/LanguageProvider'
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
  const { t, language, setLanguage } = useI18n()
  const fileInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)

  const exportBackup = async () => {
    const text = await onExportBackup()
    if (text) downloadTextFile(t.files.backup(today), text)
  }

  const exportRaw = async () => {
    const text = await onExportRaw()
    if (text) downloadTextFile(t.files.raw(today), text)
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

  const languageLabel = (code: Language) => (code === 'sv' ? t.language.svenska : t.language.english)

  return (
    <section className="page-section">
      <p className="eyebrow">
        <span className="status-dot" /> {t.settings.eyebrow}
      </p>
      <h2 className="page-title">{t.settings.title}</h2>

      <article className="settings-card">
        <h3>{t.settings.languageHeading}</h3>
        <div className="language-options" role="radiogroup" aria-label={t.settings.languageGroup}>
          {LANGUAGES.map((code) => (
            <button
              key={code}
              type="button"
              role="radio"
              lang={code}
              aria-checked={language === code}
              className={`duration-option${language === code ? ' selected' : ''}`}
              onClick={() => setLanguage(code)}
            >
              {languageLabel(code)}
            </button>
          ))}
        </div>
        <p className="small-print">{t.settings.languageHelp}</p>
      </article>

      <article className="settings-card">
        <h3>{t.settings.backupHeading}</h3>
        <p>{t.settings.backupBody}</p>
        <button type="button" className="secondary-button" onClick={() => void exportBackup()} disabled={existingCount === 0}>
          {t.settings.exportBackup}
        </button>
        <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}>
          {t.settings.importBackup}
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          aria-label={t.settings.chooseFile}
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
        <p className="small-print">{t.settings.importNote}</p>
      </article>

      <article className="settings-card">
        <h3>{t.settings.storageHeading}</h3>
        <dl>
          <div>
            <dt>{t.settings.whereLabel}</dt>
            <dd>{t.settings.whereValue}</dd>
          </div>
          <div>
            <dt>{t.settings.protectedLabel}</dt>
            <dd>{persisted === null ? t.settings.unknown : persisted ? t.settings.yes : t.settings.no}</dd>
          </div>
        </dl>
        <p>{t.settings.storageBody}</p>
        <p>{t.settings.noBank}</p>
      </article>

      <article className="settings-card">
        <h3>{t.settings.installHeading}</h3>
        <p>{t.settings.installBody}</p>
      </article>

      <article className="settings-card quiet">
        <h3>{t.settings.advancedHeading}</h3>
        <p>{t.settings.advancedBody}</p>
        <button type="button" className="secondary-button" onClick={() => void exportRaw()}>
          {t.settings.saveRaw}
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
