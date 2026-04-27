import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'
import {
  ArrowRight,
  Dices,
  LogIn,
  LogOut,
  MessageSquare,
  Send,
  Sword,
} from 'lucide-react'

import { Button } from '@repo/ui/components/button'
import { Input } from '@repo/ui/components/input'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoomEvent {
  _id: string
  roomId: string
  userId: string
  username: string
  type: 'chat' | 'dice_roll' | 'turn_change' | 'join' | 'leave'
  payload: Record<string, unknown>
  createdAt: number
}

// ---------------------------------------------------------------------------
// Individual event row
// ---------------------------------------------------------------------------

function EventRow({ event, localUserId }: { event: RoomEvent; localUserId: string | undefined }) {
  const isMe = event.userId === localUserId
  const time = new Date(event.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (event.type === 'chat') {
    const message = event.payload.message as string
    return (
      <div className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
        <div
          className={`max-w-[80%] space-y-0.5 ${isMe ? 'items-end' : 'items-start'} flex flex-col`}
        >
          {!isMe && (
            <span className="text-[10px] text-text-muted px-1">{event.username}</span>
          )}
          <div
            className={`rounded-lg px-2.5 py-1.5 text-xs ${
              isMe
                ? 'bg-brand/20 text-brand-muted-foreground'
                : 'bg-surface-2 text-text-secondary'
            }`}
          >
            {message}
          </div>
          <span className="text-[10px] text-text-muted px-1">{time}</span>
        </div>
      </div>
    )
  }

  if (event.type === 'dice_roll') {
    const { die, result, sides } = event.payload as { die: string; result: number; sides: number }
    const isCrit = die !== 'coin' && result === sides
    const isFumble = die !== 'coin' && result === 1
    const displayResult = die === 'coin' ? (result === 1 ? 'Heads' : 'Tails') : String(result)
    return (
      <div className="flex items-center gap-2 py-0.5">
        <Dices className="h-3 w-3 shrink-0 text-sky-400" />
        <span className="text-xs text-text-muted">
          <span className="text-text-secondary font-medium">{event.username}</span>
          {' rolled '}
          <span
            className={`font-bold tabular-nums ${
              isCrit ? 'text-emerald-400' : isFumble ? 'text-destructive' : 'text-text-primary'
            }`}
          >
            {displayResult}
          </span>
          {isCrit && <span className="text-emerald-400"> — Critical!</span>}
          {isFumble && <span className="text-destructive"> — Fumble</span>}
          {' on '}
          {die === 'coin' ? 'coin' : die.toUpperCase()}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-text-muted">{time}</span>
      </div>
    )
  }

  if (event.type === 'turn_change') {
    const { toUsername } = event.payload as { toUsername: string }
    return (
      <div className="flex items-center gap-2 py-0.5">
        <Sword className="h-3 w-3 shrink-0 text-violet-400" />
        <span className="text-xs text-text-muted">
          <span className="text-violet-400 font-medium">{toUsername}</span>
          {`'s turn`}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-text-muted">{time}</span>
      </div>
    )
  }

  if (event.type === 'join') {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <LogIn className="h-3 w-3 shrink-0 text-emerald-400" />
        <span className="text-xs text-text-muted">
          <span className="text-emerald-400 font-medium">{event.username}</span>
          {' joined'}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-text-muted">{time}</span>
      </div>
    )
  }

  if (event.type === 'leave') {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <LogOut className="h-3 w-3 shrink-0 text-text-muted" />
        <span className="text-xs text-text-muted">
          <span className="font-medium">{event.username}</span>
          {' left'}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-text-muted">{time}</span>
      </div>
    )
  }

  // Arrow-right generic fallback (turn_change with different payload shape, etc.)
  return (
    <div className="flex items-center gap-2 py-0.5">
      <ArrowRight className="h-3 w-3 shrink-0 text-text-muted" />
      <span className="text-xs text-text-muted">{event.username}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface GameLogPanelProps {
  roomId: string
}

export function GameLogPanel({ roomId }: GameLogPanelProps) {
  const { user } = useAuth()
  const events = useQuery(api.gameEvents.listEvents, { roomId, limit: 100 }) as RoomEvent[] | undefined
  const sendChat = useMutation(api.gameEvents.sendChat)

  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    const count = events?.length ?? 0
    if (count > prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevCountRef.current = count
  }, [events?.length])

  const handleSend = useCallback(async () => {
    const trimmed = message.trim()
    if (!trimmed || sending) return
    setSending(true)
    try {
      await sendChat({ roomId, message: trimmed })
      setMessage('')
    } finally {
      setSending(false)
    }
  }, [message, sending, sendChat, roomId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Event feed */}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {!events ? (
          <p className="py-4 text-center text-xs text-text-muted">Loading…</p>
        ) : events.length === 0 ? (
          <div className="py-6 flex flex-col items-center gap-2">
            <MessageSquare className="h-6 w-6 text-text-muted/40" />
            <p className="text-xs text-text-muted">No activity yet</p>
          </div>
        ) : (
          events.map((event) => (
            <EventRow key={event._id} event={event} localUserId={user?.id} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Chat input */}
      <div className="shrink-0 border-t border-surface-2 p-2">
        <div className="flex gap-1.5">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Say something…"
            maxLength={500}
            className="h-7 text-xs border-surface-3 bg-surface-0 focus:border-brand/50"
            disabled={sending}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-brand-muted-foreground hover:text-brand-foreground disabled:opacity-40"
            onClick={() => void handleSend()}
            disabled={!message.trim() || sending}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
