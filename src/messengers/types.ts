import type { GreenApiClient } from '../api/types'

export type MessengerId = 'max' | 'telegram' | 'whatsapp'

export interface ResolvedChat {
  chatId: string
  title: string
}

export interface MessengerProfile {
  title: string
  typeInstance: 'v3' | 'telegram' | 'whatsapp'
  defaultApiUrl: string
  maxMessageLength: number
  resolveChat(
    client: GreenApiClient,
    digits: string,
    signal?: AbortSignal,
  ): Promise<ResolvedChat | null>
}
