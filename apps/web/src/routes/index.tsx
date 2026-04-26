import { useEffect } from 'react'
import { ErrorFallback } from '@/components/ErrorFallback'
import { LandingPage } from '@/components/LandingPage'
import { useAuth } from '@/contexts/AuthContext'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { ErrorBoundary } from 'react-error-boundary'
import { z } from 'zod'

// Key for storing the return URL after OAuth (must match game route)
const AUTH_RETURN_TO_KEY = 'auth-return-to'

const searchSchema = z.object({
  error: z.string().optional(),
  /** Workaround for /game/{id} SSR 500 — share links use /?join=ROOMID and we redirect client-side */
  join: z.string().optional(),
  /** Optional label for additional seats (carried through to the game route) */
  seatLabel: z.string().optional(),
  /** "1" when this tab is intentionally a duplicate seat (coerce: TanStack Router JSON-parses numbers) */
  intentional: z.coerce.string().optional(),
})

export const Route = createFileRoute('/')({
  // Set to false because nitro's bundled use-sync-external-store / React 19
  // shim crashes during SSR (`Cannot set properties of undefined (setting
  // 'Activity')`). The landing page is small + works fine as SPA, so
  // bypassing SSR here is the simplest unblock.
  ssr: false,
  component: LandingPageRoute,
  validateSearch: zodValidator(searchSchema),
})

function LandingPageContent() {
  const { error, join, seatLabel, intentional } = Route.useSearch()
  const navigate = useNavigate()
  const {
    user,
    isLoading: isAuthLoading,
    signIn,
    signInWithPreviewCode,
  } = useAuth()

  // Workaround for /game/{id} SSR 500: share links land here as
  // /?join=ROOMID and we navigate client-side to the game route, bypassing
  // SSR entirely. If the user isn't authed yet, stash the target so the
  // post-auth redirect lands them in the room.
  useEffect(() => {
    if (!join) return
    const params = new URLSearchParams()
    if (seatLabel) params.set('seatLabel', seatLabel)
    if (intentional === '1') params.set('intentional', '1')
    const qs = params.toString()
    const target = `/game/${join}${qs ? `?${qs}` : ''}`
    if (isAuthLoading) return
    if (!user) {
      window.sessionStorage.setItem(AUTH_RETURN_TO_KEY, target)
      return
    }
    navigate({ to: target })
  }, [join, seatLabel, intentional, user, isAuthLoading, navigate])

  // After authentication completes, redirect to the stored return URL (e.g., game room)
  useEffect(() => {
    if (user && !isAuthLoading) {
      const returnTo = window.sessionStorage.getItem(AUTH_RETURN_TO_KEY)
      if (returnTo) {
        window.sessionStorage.removeItem(AUTH_RETURN_TO_KEY)
        navigate({ to: returnTo })
      }
    }
  }, [user, isAuthLoading, navigate])

  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <ErrorFallback error={error} resetErrorBoundary={resetErrorBoundary} />
      )}
      onReset={() => window.location.reload()}
    >
      <LandingPage
        initialError={error || null}
        inviteState={null}
        onRefreshInvite={() => {}}
        isRefreshingInvite={false}
        user={user}
        isAuthLoading={isAuthLoading}
        onSignIn={signIn}
        onPreviewSignIn={signInWithPreviewCode}
      />
    </ErrorBoundary>
  )
}

function LandingPageRoute() {
  return <LandingPageContent />
}
