/**
 * AddSeatDialog — opens a new tab as a second seat for the same room.
 * Primary use case: selfie cam + tabletop cam from the same user.
 *
 * The new tab navigates to `/?join=ROOMID&seatLabel=...&intentional=1`,
 * which the landing route detects and forwards into the in-flight join
 * flow with `intentionalDuplicate: true` (bypassing the duplicate-session
 * dialog and inserting as a linked seat).
 */
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Camera } from 'lucide-react'

import { Button } from '@repo/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/dialog'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'

interface AddSeatDialogProps {
  roomId: string
  trigger?: ReactNode
  /** Disable the trigger when user already has the maximum number of seats */
  disabled?: boolean
}

const MAX_LABEL_CHARS = 40

export function AddSeatDialog({
  roomId,
  trigger,
  disabled,
}: AddSeatDialogProps) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('Tabletop')

  const submit = () => {
    const trimmed = label.trim().slice(0, MAX_LABEL_CHARS)
    if (!trimmed) return
    const url = new URL('/', window.location.origin)
    url.searchParams.set('join', roomId)
    url.searchParams.set('seatLabel', trimmed)
    url.searchParams.set('intentional', '1')
    window.open(url.toString(), '_blank', 'noopener')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            data-testid="add-seat-button"
          >
            <Camera className="mr-2 h-4 w-4" />
            Add camera
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md border-surface-2 bg-surface-1">
        <DialogHeader>
          <DialogTitle>Add another camera</DialogTitle>
          <DialogDescription>
            Opens a new tab as a second seat for this room. Useful for adding a
            tabletop view alongside your selfie cam — life, poison, and counters
            stay synced between your seats.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="seat-label">Label this seat</Label>
          <Input
            id="seat-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={MAX_LABEL_CHARS}
            placeholder="Tabletop"
            autoFocus
          />
          <p className="text-xs text-text-muted">
            Shows next to your name on the tile (e.g. &ldquo;Tony Lam ·
            Tabletop&rdquo;).
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!label.trim()}>
            Open in new tab
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
