import { useState } from 'react'
import { downloadTextFile } from '../app/download'
import { ConfirmDialog } from './ConfirmDialog'

interface RecoveryScreenProps {
  today: string
  /** The latest error, if any: these screens have no other place to show it. */
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
  const [exported, setExported] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const exportRaw = async () => {
    const text = await onExportRaw()
    if (!text) return
    downloadTextFile(`50k-sparande-radata-${today}.json`, text)
    setExported(true)
  }

  return (
    <main className="app-shell">
      <section className="page-section">
        <p className="eyebrow">
          <span className="status-dot warning" /> Sparad data kunde inte läsas
        </p>
        <h1 className="challenge-title">Din tidigare data är skadad</h1>
        <p className="page-intro">
          Appen hittade sparad data från en tidigare version, men den går inte att läsa säkert. <b>Inget har raderats eller ändrats.</b>
        </p>
        <ErrorLine error={error} />

        <article className="settings-card">
          <h3>Steg 1. Spara en kopia (rekommenderas)</h3>
          <p>
            Rådata är en teknisk fil som kan kräva hjälp av någon med teknisk kunskap för att läsas. Spara den ändå, så finns den kvar om du
            behöver den senare.
          </p>
          <button type="button" className="draw-button" onClick={() => void exportRaw()}>
            Spara rådata
          </button>
          {exported && <p className="confirmed-copy">Rådatan är sparad som en fil på din enhet.</p>}
        </article>

        <article className="settings-card">
          <h3>Steg 2. Fortsätt utan den skadade datan</h3>
          <p>
            Då startar appen utan den. Den skadade datan finns kvar orörd på enheten och kan sparas som rådata senare. Du kan sedan skapa en ny
            utmaning eller importera en säkerhetskopia.
          </p>
          <button type="button" className="danger-button" onClick={() => setConfirming(true)}>
            Fortsätt utan den skadade datan
          </button>
        </article>
      </section>

      {confirming && (
        <ConfirmDialog
          title="Fortsätta utan den skadade datan?"
          confirmLabel="Ja, fortsätt"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            void onSkip()
          }}
        >
          <p>
            Appen startar tom. Den skadade datan raderas <b>inte</b> – den ligger kvar på enheten men visas inte.
          </p>
          {!exported && <p>Du har ännu inte sparat någon kopia av rådatan. Vi rekommenderar att du gör det först.</p>}
        </ConfirmDialog>
      )}
    </main>
  )
}

interface StorageProblemScreenProps {
  today: string
  message: string
  error?: string
  onExportRaw: () => Promise<string | undefined>
  onRetry: () => void
}

/** The stored data could not be used for another reason. Nothing is changed; a raw copy can still be saved. */
export function StorageProblemScreen({ today, message, error, onExportRaw, onRetry }: StorageProblemScreenProps) {
  const exportRaw = async () => {
    const text = await onExportRaw()
    if (text) downloadTextFile(`50k-sparande-radata-${today}.json`, text)
  }

  return (
    <main className="app-shell">
      <section className="page-section">
        <p className="eyebrow">
          <span className="status-dot warning" /> Något gick fel
        </p>
        <h1 className="challenge-title">Datan kunde inte öppnas</h1>
        <p className="page-intro" role="alert">
          {message}
        </p>
        <article className="settings-card">
          <p>Inget har ändrats. Du kan försöka igen eller spara en teknisk kopia av allt som finns lagrat.</p>
          <button type="button" className="draw-button" onClick={onRetry}>
            Försök igen
          </button>
          <button type="button" className="secondary-button" onClick={() => void exportRaw()}>
            Spara rådata
          </button>
          <ErrorLine error={error} />
        </article>
      </section>
    </main>
  )
}

/** A newer copy of the app has upgraded the stored data. Writing from this older copy could damage it. */
export function OutdatedScreen() {
  return (
    <main className="app-shell">
      <section className="page-section">
        <p className="eyebrow">
          <span className="status-dot warning" /> Ny version
        </p>
        <h1 className="challenge-title">Appen behöver laddas om</h1>
        <p className="page-intro">
          Din sparade data har uppdaterats av en nyare version av appen. Ladda om för att fortsätta. Den här sidan sparar ingenting, så inget kan
          skadas.
        </p>
        <button type="button" className="draw-button" onClick={() => window.location.reload()}>
          Ladda om
        </button>
      </section>
    </main>
  )
}
