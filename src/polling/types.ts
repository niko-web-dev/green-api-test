import type { GreenApiError } from '../api/types'

export type LoopStatus = 'online' | 'reconnecting' | 'stopped'

export interface LoopHandlers {
  onNotification(body: Record<string, unknown>): void
  onStatus(status: LoopStatus, error?: GreenApiError): void
}
