import type { ReactNode } from 'react'
import { useSemanticColor } from '../hooks/useSemanticColor'

export function SemanticColorText({ color, className, children }: { color: string; className?: string; children: ReactNode }): React.JSX.Element {
  const appearance = useSemanticColor(color)
  return <span className={className} style={{ color: appearance.text }}>{children}</span>
}
