import { useEffect, useRef, type ReactNode } from 'react'

interface ConfirmDialogProps {
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** A modal that must be answered. Focus starts on the safe choice (cancel) and Escape cancels. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Avbryt',
  danger = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelButton = useRef<HTMLButtonElement>(null)
  const latestCancel = useRef(onCancel)

  useEffect(() => {
    latestCancel.current = onCancel
  })

  useEffect(() => {
    cancelButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') latestCancel.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" ref={cancelButton} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'danger-button solid' : 'draw-button'}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
