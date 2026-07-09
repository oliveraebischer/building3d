export type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open, title, message, confirmLabel = 'Exit & View', cancelLabel = 'Cancel',
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[320px] bg-[#161616] border border-white/[0.1] rounded-xl p-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-[12px] text-white/85 font-medium mb-1.5">{title}</p>
        <p className="text-[11px] text-white/45 leading-relaxed mb-4">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-[10px] font-semibold text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-md text-[10px] font-semibold bg-white text-[#0d0d0d] hover:bg-white/90 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
