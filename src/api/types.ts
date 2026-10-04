export interface Credentials {
  apiUrl: string
  idInstance: string
  apiTokenInstance: string
}

export interface ReceivedNotification {
  receiptId: number
  body: Record<string, unknown>
}

export interface StateInstanceResponse {
  stateInstance: string
}

export interface CheckAccountResponse {
  exist: boolean
  chatId: string
}

export interface CheckWhatsappResponse {
  existsWhatsapp: boolean
}

export interface SendMessageResponse {
  idMessage: string
}

export type GreenApiErrorKind =
  | 'auth'
  | 'notReady'
  | 'phoneCheckLimit'
  | 'quota'
  | 'rateLimit'
  | 'webhookSet'
  | 'badRequest'
  | 'server'
  | 'network'
  | 'aborted'

export interface GreenApiClient {
  getStateInstance(signal?: AbortSignal): Promise<string>
  checkAccount(
    phone: number,
    signal?: AbortSignal,
  ): Promise<CheckAccountResponse>
  checkWhatsapp(
    phone: number,
    signal?: AbortSignal,
  ): Promise<CheckWhatsappResponse>
  sendMessage(
    chatId: string,
    message: string,
    signal?: AbortSignal,
  ): Promise<SendMessageResponse>
  receiveNotification(
    timeoutSec: number,
    signal?: AbortSignal,
  ): Promise<ReceivedNotification | null>
  deleteNotification(receiptId: number, signal?: AbortSignal): Promise<void>
}

export interface GreenApiError extends Error {
  kind: GreenApiErrorKind
  status?: number
}

export interface RequestOptions {
  verb?: string
  body?: unknown
  suffix?: string
  timeoutMs?: number
}
