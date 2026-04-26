/**
 * DuplicateSessionDialog - Shown when user is already connected from another tab
 *
 * Gives the user the choice to either:
 * 1. Transfer to this tab (disconnects the other tab)
 * 2. Leave this tab and keep the other session
 */

import { AlertTriangle, ArrowRightLeft, Camera, Home } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/dialog'

interface DuplicateSessionDialogProps {
  open: boolean
  onTransfer: () => void
  onClose: () => void
  /** Join this tab as an additional linked seat (e.g. tabletop camera from mobile) */
  onJoinAsTabletop?: () => void
}

export function DuplicateSessionDialog({
  open,
  onTransfer,
  onClose,
  onJoinAsTabletop,
}: DuplicateSessionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-[450px] border-warning/50 bg-surface-1 [&>button]:hidden">
        <DialogHeader>
          <div className="mb-2 flex justify-center">
            <div className="h-12 w-12 flex items-center justify-center rounded-full bg-warning/20">
              <AlertTriangle className="h-6 w-6 text-warning-muted-foreground" />
            </div>
          </div>
          <DialogTitle className="text-center text-text-primary">
            Already Connected
          </DialogTitle>
          <DialogDescription className="text-center text-text-muted">
            You&apos;re already in this game room from another tab or window.
            Would you like to continue here instead?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          <button
            onClick={onTransfer}
            className="group p-4 w-full cursor-pointer rounded-lg border border-brand/30 bg-surface-0/30 text-left transition-all hover:border-brand/60 hover:bg-surface-1/40 focus:ring-2 focus:ring-brand/50 focus:outline-none"
          >
            <div className="gap-3 flex items-start">
              <div className="h-10 w-10 flex shrink-0 items-center justify-center rounded-lg bg-brand/20 transition-colors group-hover:bg-brand/30">
                <ArrowRightLeft className="h-5 w-5 text-brand-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-brand-muted-foreground">
                  Transfer here
                </p>
                <p className="mt-0.5 text-sm text-text-muted">
                  Disconnect from the other tab and continue in this one.
                </p>
              </div>
            </div>
          </button>

          {onJoinAsTabletop && (
            <button
              onClick={onJoinAsTabletop}
              className="group p-4 w-full cursor-pointer rounded-lg border border-emerald-500/30 bg-surface-0/30 text-left transition-all hover:border-emerald-500/60 hover:bg-surface-1/40 focus:ring-2 focus:ring-emerald-500/50 focus:outline-none"
            >
              <div className="gap-3 flex items-start">
                <div className="h-10 w-10 flex shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 transition-colors group-hover:bg-emerald-500/30">
                  <Camera className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <p className="font-medium text-emerald-400">
                    Join as tabletop camera
                  </p>
                  <p className="mt-0.5 text-sm text-text-muted">
                    Add this device as a second camera — both stay connected.
                  </p>
                </div>
              </div>
            </button>
          )}

          <button
            onClick={onClose}
            className="group p-4 w-full cursor-pointer rounded-lg border border-surface-3 bg-surface-2/50 text-left transition-all hover:border-surface-3 hover:bg-surface-2 focus:ring-2 focus:ring-surface-3/50 focus:outline-none"
          >
            <div className="gap-3 flex items-start">
              <div className="h-10 w-10 flex shrink-0 items-center justify-center rounded-lg bg-surface-3/50 transition-colors group-hover:bg-surface-3">
                <Home className="h-5 w-5 text-text-muted" />
              </div>
              <div>
                <p className="font-medium text-text-secondary">
                  Return to Home
                </p>
                <p className="mt-0.5 text-sm text-text-muted">
                  Keep your existing session in the other tab.
                </p>
              </div>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
