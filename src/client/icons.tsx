/** Small inline glyphs (currentColor strokes) for artifact types. */
import type { ReactNode } from 'react'

interface GlyphProps {
  readonly size?: number | undefined
  readonly className?: string | undefined
}

function Svg({ size = 18, className, children }: GlyphProps & { children: ReactNode }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  )
}

/** Generic artifact mark: a framed page with a spark. */
export function ArtifactGlyph(props: GlyphProps): ReactNode {
  return (
    <Svg {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M3.5 8.5h17" />
      <path d="M12 11.5l1.2 2.3 2.3 1.2-2.3 1.2L12 18.5l-1.2-2.3-2.3-1.2 2.3-1.2z" />
    </Svg>
  )
}

export function TypeGlyph({ type, ...props }: GlyphProps & { readonly type: string }): ReactNode {
  switch (type) {
    case 'html':
      return <Svg {...props}><path d="M8 7l-5 5 5 5" /><path d="M16 7l5 5-5 5" /><path d="M13.5 4.5l-3 15" /></Svg>
    case 'react':
      return (
        <Svg {...props}>
          <circle cx="12" cy="12" r="1.6" />
          <ellipse cx="12" cy="12" rx="9.5" ry="3.8" />
          <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(120 12 12)" />
        </Svg>
      )
    case 'svg':
      return <Svg {...props}><circle cx="8" cy="9" r="4" /><path d="M13 20l4.5-8 4.5 8z" /><rect x="3" y="15" width="6" height="6" rx="1" /></Svg>
    case 'mermaid':
      return <Svg {...props}><rect x="3" y="3.5" width="7" height="5" rx="1.2" /><rect x="14" y="15.5" width="7" height="5" rx="1.2" /><rect x="3" y="15.5" width="7" height="5" rx="1.2" /><path d="M6.5 8.5v7M10 18h4M6.5 12h11v3.5" /></Svg>
    case 'markdown':
      return <Svg {...props}><path d="M6 3.5h8.5L19 8v12.5H6z" /><path d="M14.5 3.5V8H19" /><path d="M9 12.5h7M9 16h5" /></Svg>
    case 'code':
      return <Svg {...props}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M8 10l-2.5 2.5L8 15M16 10l2.5 2.5L16 15" /></Svg>
    default:
      return <ArtifactGlyph {...props} />
  }
}

export function Spinner({ size = 16, className }: GlyphProps): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`dsha-spin${className ? ` ${className}` : ''}`} aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.4" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}
