export function LoadingSpinner({ text }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div
        className="w-6 h-6 border-2 rounded-full animate-spin"
        style={{
          borderColor: 'var(--tg-theme-secondary-bg-color)',
          borderTopColor: 'var(--tg-theme-button-color)'
        }}
      />
      {text && (
        <p className="text-xs font-light mt-3" style={{ color: 'var(--tg-theme-hint-color)' }}>
          {text}
        </p>
      )}
    </div>
  )
}
