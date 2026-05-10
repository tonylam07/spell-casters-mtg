/**
 * Server-side deck fetch functions using TanStack Start server functions.
 *
 * Moxfield's API is behind Cloudflare bot protection, which blocks
 * Convex action servers. These server functions run on Vercel's
 * serverless infrastructure which can pass Cloudflare challenges.
 *
 * Falls back to Convex actions if server functions fail.
 */

import { createServerFn } from '@tanstack/react-start'

export const fetchMoxfieldDeckServer = createServerFn({
  method: 'GET',
})
  .validator((deckId: string) => deckId)
  .handler(async ({ data: deckId }) => {
    const url = `https://api2.moxfield.com/v2/decks/all/${deckId}`
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      // Return error payload instead of throwing — caller can handle it
      const text = await res.text().catch(() => '')
      const isCloudflare =
        text.includes('Cloudflare') || text.includes('cf-browser-verification')
      return {
        error: isCloudflare
          ? 'Moxfield is blocking automated requests. Please use the Text tab instead — copy your deck list from Moxfield and paste it.'
          : `Moxfield API returned ${res.status}: ${res.statusText}`,
      }
    }

    return await res.json()
  })

export const fetchArchidektDeckServer = createServerFn({
  method: 'GET',
})
  .validator((deckId: string) => deckId)
  .handler(async ({ data: deckId }) => {
    const url = `https://archidekt.com/api/decks/${deckId}/`
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      return {
        error: `Archidekt API returned ${res.status}: ${res.statusText}`,
      }
    }

    return await res.json()
  })
