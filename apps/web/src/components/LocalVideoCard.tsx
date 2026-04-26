import type { DetectorType } from '@/lib/detectors'
import type { Participant } from '@/types/participant'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCardQueryContext } from '@/contexts/CardQueryContext'
import { useMediaStreams } from '@/contexts/MediaStreamContext'
import { useCardDetector } from '@/hooks/useCardDetector'
import { useTrackedCards } from '@/hooks/useTrackedCards'
import { useVideoOrientation } from '@/hooks/useVideoOrientation'
import { attachVideoStream } from '@/lib/video-stream-utils'
import { Bookmark, Loader2, MicOff } from 'lucide-react'
import { toast } from 'sonner'

import { ContextMenuItem } from '@repo/ui/components/context-menu'

import { PlayerStatsOverlay } from './PlayerStatsOverlay'
import { PlayerVideoCard } from './PlayerVideoCard'
import {
  CardDetectionOverlay,
  CroppedCanvas,
  FullResCanvas,
  LocalMediaControls,
  VideoDisabledPlaceholder,
} from './PlayerVideoCardParts'
import { TrackedCardTray } from './TrackedCardTray'
import { VideoOrientationContextMenu } from './VideoOrientationContextMenu'

// Container that holds the video + detection overlay; the orientation
// transform is applied here so the overlay stays aligned with the video.
const ORIENTED_CONTAINER_BASE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  transformOrigin: 'center center',
  transition: 'transform 150ms ease-out',
}

// Extract inline style to prevent recreation
const LOCAL_VIDEO_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  zIndex: 0,
}

interface LocalVideoCardProps {
  stream?: MediaStream | null
  enableCardDetection?: boolean
  detectorType?: DetectorType
  usePerspectiveWarp?: boolean
  onCardCrop?: (canvas: HTMLCanvasElement) => void
  roomId?: string
  participant?: Participant
  currentUser?: Participant
  participants?: Participant[]
  gridIndex?: number
}

export const LocalVideoCard = memo(function LocalVideoCard({
  stream,
  enableCardDetection = true,
  detectorType,
  usePerspectiveWarp = true,
  onCardCrop,
  roomId,
  participant,
  currentUser,
  participants,
  gridIndex: _gridIndex = 0,
}: LocalVideoCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoContainerRef = useRef<HTMLDivElement>(null)

  // Get toggle functions and state from media stream context
  // Using context directly for proper resource release/acquisition
  const {
    toggleVideo,
    toggleAudio: toggleLocalAudio,
    mediaPreferences: { videoEnabled, audioEnabled },
    permissions: { microphoneAvailable },
  } = useMediaStreams()

  const [isTogglingVideo, setIsTogglingVideo] = useState(false)

  // Wrap toggle to handle loading state
  const handleToggleVideo = useCallback(
    async (enabled: boolean) => {
      setIsTogglingVideo(true)
      try {
        await toggleVideo(enabled)
      } finally {
        setIsTogglingVideo(false)
      }
    },
    [toggleVideo],
  )

  // Initialize card detector (only when stream exists)
  const { overlayRef, croppedRef, fullResRef, getCroppedCanvas } =
    useCardDetector({
      videoRef: videoRef,
      enableCardDetection: enableCardDetection && !!stream,
      detectorType,
      usePerspectiveWarp,
      onCrop: onCardCrop,
      reinitializeTrigger: stream ? 1 : 0,
    })

  // Card-query context: lets a click on the live tile trigger CLIP recognition
  // against whatever the detector last cropped (independent of the auto-loop).
  const cardQuery = useCardQueryContext()
  const handleIdentifyClick = useCallback(() => {
    const canvas = getCroppedCanvas()
    if (!canvas) return
    // Reset consensus so the picker reflects only the fresh sequence of
    // detections triggered by this click, not stale frames from a prior card.
    cardQuery.resetConsensus()
    void cardQuery.query(canvas)
  }, [cardQuery, getCroppedCanvas])

  // Tracked cards (Convex live query, owner-gated mutations)
  const { cards, trackCard, untrackCard, bump } = useTrackedCards(roomId ?? '')
  const myCards = useMemo(
    () => cards.filter((card) => card.ownerUserId === currentUser?.id),
    [cards, currentUser?.id],
  )
  const lastResult = cardQuery.state.result
  const isQuerying = cardQuery.state.status === 'querying'
  const queryStatus = cardQuery.state.status
  const trackTopSlot = (() => {
    if (lastResult?.scryfallId) {
      return (
        <ContextMenuItem
          onSelect={() => {
            if (!lastResult.scryfallId) return
            void trackCard(lastResult.scryfallId, lastResult.name)
              .then(() =>
                toast.success(`Tracking "${lastResult.name}"`, {
                  duration: 2500,
                }),
              )
              .catch((error) => {
                console.error('[LocalVideoCard] trackCard failed:', error)
                toast.error('Failed to track card')
              })
          }}
        >
          <Bookmark className="mr-2 h-4 w-4" />
          Track {lastResult.name}
        </ContextMenuItem>
      )
    }
    if (isQuerying) {
      return (
        <ContextMenuItem disabled>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Identifying card...
        </ContextMenuItem>
      )
    }
    return (
      <ContextMenuItem onSelect={handleIdentifyClick}>
        <Bookmark className="mr-2 h-4 w-4" />
        Scan for card
      </ContextMenuItem>
    )
  })()

  // Audio muted state is derived from context's audioEnabled preference
  const isAudioMuted = !audioEnabled

  // Stable callback ref - only assigns the element to the ref
  // Stream attachment is handled separately in useEffect to avoid flickering
  // when the stream reference changes (e.g., when toggling audio)
  const handleVideoRef = useCallback(
    (videoElement: HTMLVideoElement | null) => {
      videoRef.current = videoElement
    },
    [],
  )

  // Attach stream to video element when VIDEO TRACKS change
  // This is separate from the ref callback to prevent flickering:
  // - Callback refs that depend on props cause React to call old(null) then new(element) when props change
  // - By using a stable callback ref + useEffect, we update the srcObject without remounting
  // - We compare actual video track objects, not stream reference, because combinedStream
  //   creates a new MediaStream object when audio changes (even if video tracks are the same)
  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return

    // Get video tracks from the new stream
    const newVideoTracks = stream.getVideoTracks()

    // Get video tracks from the currently attached stream
    const currentStream = video.srcObject as MediaStream | null
    const currentVideoTracks = currentStream?.getVideoTracks() ?? []

    // Only re-attach if video tracks have actually changed
    // This prevents flickering when only audio is toggled
    const tracksAreSame =
      newVideoTracks.length === currentVideoTracks.length &&
      newVideoTracks.every((track, i) => track === currentVideoTracks[i])

    if (tracksAreSame) {
      return
    }

    attachVideoStream(video, stream)
  }, [stream])

  const handleToggleAudio = useCallback(() => {
    // Toggle audio - context will release/acquire mic resources
    // isAudioMuted = !audioEnabled, so passing isAudioMuted toggles to the opposite state
    toggleLocalAudio(isAudioMuted)
  }, [toggleLocalAudio, isAudioMuted])

  // Show video only when enabled AND stream has video tracks
  const hasVideoStream =
    videoEnabled && stream && stream.getVideoTracks().length > 0

  // Orientation + zoom: per-tile transform persisted to localStorage
  const orientation = useVideoOrientation('local')
  const orientedContainerStyle = useMemo<React.CSSProperties>(
    () => ({ ...ORIENTED_CONTAINER_BASE, transform: orientation.transform }),
    [orientation.transform],
  )

  // Mouse-wheel zoom (Shift+Wheel to avoid hijacking page scroll)
  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!event.shiftKey) return
      event.preventDefault()
      if (event.deltaY < 0) orientation.zoomIn()
      else if (event.deltaY > 0) orientation.zoomOut()
    },
    [orientation],
  )

  return (
    <PlayerVideoCard ref={videoContainerRef}>
      {hasVideoStream ? (
        <VideoOrientationContextMenu
          orientation={orientation}
          topSlot={trackTopSlot}
        >
          <div
            style={orientedContainerStyle}
            onClick={handleIdentifyClick}
            onWheel={handleWheel}
            role="button"
            tabIndex={-1}
            aria-label="Click to identify card"
          >
            <video
              ref={handleVideoRef}
              autoPlay
              muted
              playsInline
              style={LOCAL_VIDEO_STYLE}
            />
            {enableCardDetection && overlayRef && (
              <CardDetectionOverlay overlayRef={overlayRef} />
            )}
            {enableCardDetection && croppedRef && (
              <CroppedCanvas croppedRef={croppedRef} />
            )}
            {enableCardDetection && fullResRef && (
              <FullResCanvas fullResRef={fullResRef} />
            )}
          </div>
        </VideoOrientationContextMenu>
      ) : (
        <VideoDisabledPlaceholder />
      )}

      {/* Card recognition status badge */}
      {enableCardDetection && (
        <div className="pointer-events-none absolute bottom-10 left-0 right-0 z-20 flex justify-center px-2">
          {isQuerying && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/40 bg-blue-500/20 px-2.5 py-1 text-xs font-medium text-blue-200 shadow backdrop-blur-sm">
              <Loader2 className="h-3 w-3 animate-spin" />
              Identifying…
            </div>
          )}
          {!isQuerying && queryStatus === 'success' && lastResult && (
            <div className="inline-flex max-w-[90%] items-center gap-1.5 truncate rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-200 shadow backdrop-blur-sm">
              <span className="truncate">✓ {lastResult.name}</span>
              {lastResult.confidence !== undefined && (
                <span className="shrink-0 opacity-70">
                  {Math.round(lastResult.confidence * 100)}%
                </span>
              )}
            </div>
          )}
          {!isQuerying && queryStatus === 'error' && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-200 shadow backdrop-blur-sm">
              Card not recognized
            </div>
          )}
          {!isQuerying && queryStatus === 'idle' && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-xs text-white/50 shadow backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
              Scanning
            </div>
          )}
        </div>
      )}

      {/* No-mic banner — surfaces gracefully when mic is denied/missing */}
      {!microphoneAvailable && (
        <div
          data-testid="no-microphone-banner"
          className="left-3 top-3 gap-1.5 px-2 py-1 text-xs shadow-sm backdrop-blur-sm absolute z-20 inline-flex items-center rounded-md border border-warning/40 bg-warning/15 text-warning"
          title="Other players will not hear you"
        >
          <MicOff className="h-3 w-3" />
          <span>No microphone</span>
        </div>
      )}

      {/* Stats Overlay */}
      {roomId && participant && participants && (
        <PlayerStatsOverlay
          roomId={roomId}
          participant={participant}
          participants={participants}
          currentUserId={currentUser?.id}
          videoContainerRef={videoContainerRef}
        />
      )}

      {/* Media Controls */}
      <LocalMediaControls
        videoEnabled={videoEnabled}
        isAudioMuted={isAudioMuted}
        onToggleVideo={handleToggleVideo}
        onToggleAudio={handleToggleAudio}
        isTogglingVideo={isTogglingVideo}
      />

      {/* Tracked cards tray (own tile, editable) */}
      {roomId && currentUser ? (
        <TrackedCardTray
          cards={myCards}
          editable
          onBump={bump}
          onUntrack={untrackCard}
        />
      ) : null}
    </PlayerVideoCard>
  )
})
