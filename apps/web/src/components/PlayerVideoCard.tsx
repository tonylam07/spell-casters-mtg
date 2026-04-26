import { forwardRef, memo, useCallback, useRef, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'

import { Card } from '@repo/ui/components/card'

interface PlayerVideoCardProps {
  children?: React.ReactNode
}

export const PlayerVideoCard = memo(
  forwardRef<HTMLDivElement, PlayerVideoCardProps>(function PlayerVideoCard(
    { children },
    ref,
  ) {
    const cardRef = useRef<HTMLDivElement>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)

    const toggleFullscreen = useCallback(async () => {
      if (!document.fullscreenElement) {
        await cardRef.current?.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    }, [])

    return (
      <Card ref={cardRef} className="flex h-full flex-col overflow-hidden border-surface-2 bg-surface-1">
        <div ref={ref} className="min-h-0 bg-black relative flex-1">
          {children}
          {/* Fullscreen toggle — top-right corner, above other overlays */}
          <button
            onClick={toggleFullscreen}
            className="absolute right-2 top-2 z-30 flex h-7 w-7 items-center justify-center rounded-md bg-black/50 text-white/70 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
            title={isFullscreen ? 'Exit fullscreen' : 'Expand tile'}
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </Card>
    )
  }),
)
