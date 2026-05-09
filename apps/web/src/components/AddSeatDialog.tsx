/**
 * AddSeatDialog — lets a player add a second camera or replace their
 * webcam with a phone. Shows a QR code for phone scanning and an
 * "Open in new tab" fallback for same-device use.
 */
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Camera, Monitor, Smartphone } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'

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
import {
  RadioGroup,
  RadioGroupItem,
} from '@repo/ui/components/radio-group'

interface AddSeatDialogProps {
  roomId: string
  trigger?: ReactNode
  /** Disable the trigger when user already has the maximum number of seats */
  disabled?: boolean
}

const MAX_LABEL_CHARS = 40

type CameraMode = 'add' | 'replace'

export function AddSeatDialog({
  roomId,
  trigger,
  disabled,
}: AddSeatDialogProps) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('Tabletop')
  const [mode, setMode] = useState<CameraMode>('add')

  const joinUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    const url = new URL('/', window.location.origin)
    url.searchParams.set('join', roomId)
    if (mode === 'add') {
      const trimmed = label.trim().slice(0, MAX_LABEL_CHARS)
      if (trimmed) url.searchParams.set('seatLabel', trimmed)
      url.searchParams.set('intentional', '1')
    } else {
      url.searchParams.set('replace', '1')
    }
    return url.toString()
  }, [roomId, mode, label])

  const handleOpenInNewTab = () => {
    if (!joinUrl) return
    window.open(joinUrl, '_blank', 'noopener')
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
            Use your phone as a tabletop camera, or open a second tab on this
            device. Life, poison, and counters stay synced.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode selector */}
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as CameraMode)}
            className="gap-2"
          >
            <label
              htmlFor="mode-add"
              className={`gap-3 rounded-lg border p-3 flex cursor-pointer items-start transition-colors ${
                mode === 'add'
                  ? 'border-brand bg-brand/10'
                  : 'border-surface-2 hover:border-surface-3'
              }`}
            >
              <RadioGroupItem value="add" id="mode-add" className="mt-0.5" />
              <div className="space-y-1">
                <div className="gap-2 flex items-center text-sm font-medium text-white">
                  <Monitor className="h-4 w-4" />
                  Add as second camera
                </div>
                <p className="text-xs text-text-muted">
                  Shows as a separate tile alongside your main camera.
                </p>
              </div>
            </label>

            <label
              htmlFor="mode-replace"
              className={`gap-3 rounded-lg border p-3 flex cursor-pointer items-start transition-colors ${
                mode === 'replace'
                  ? 'border-brand bg-brand/10'
                  : 'border-surface-2 hover:border-surface-3'
              }`}
            >
              <RadioGroupItem
                value="replace"
                id="mode-replace"
                className="mt-0.5"
              />
              <div className="space-y-1">
                <div className="gap-2 flex items-center text-sm font-medium text-white">
                  <Smartphone className="h-4 w-4" />
                  Replace my webcam
                </div>
                <p className="text-xs text-text-muted">
                  Phone takes over your video tile. No second tile created.
                </p>
              </div>
            </label>
          </RadioGroup>

          {/* Label input — only in add mode */}
          {mode === 'add' && (
            <div className="space-y-2">
              <Label htmlFor="seat-label">Label this seat</Label>
              <Input
                id="seat-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={MAX_LABEL_CHARS}
                placeholder="Tabletop"
              />
              <p className="text-xs text-text-muted">
                Shows next to your name on the tile (e.g. &ldquo;Tony ·
                Tabletop&rdquo;).
              </p>
            </div>
          )}

          {/* QR Code */}
          {joinUrl && (
            <div className="space-y-2 pt-1">
              <div className="mx-auto w-fit rounded-lg bg-white p-3">
                <QRCodeSVG
                  value={joinUrl}
                  size={180}
                  level="M"
                  marginSize={0}
                />
              </div>
              <p className="text-center text-xs text-text-muted">
                Scan with your phone&apos;s camera
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleOpenInNewTab}
            disabled={mode === 'add' && !label.trim()}
          >
            Open in new tab
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
