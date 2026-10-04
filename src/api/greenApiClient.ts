import { createGreenApiError } from './errors'
import { normalizeApiUrl } from './apiUrl'
import type {
  Credentials,
  GreenApiClient,
  GreenApiErrorKind,
  RequestOptions,
  StateInstanceResponse,
} from './types'

function httpErrorKind(status: number, body: string): GreenApiErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 466) return 'quota'
  if (status === 469) return 'phoneCheckLimit'
  if (status === 429) return 'rateLimit'
  if (status === 408 || status === 499) return 'network'
  if (status === 400 && /webhook[\s_-]*url/i.test(body)) return 'webhookSet'
  if (status === 400 && /instance (is|in) starting|not authorized/i.test(body))
    return 'notReady'
  if (status === 400 && /limit reached/i.test(body)) return 'phoneCheckLimit'
  if (status >= 400 && status < 500) return 'badRequest'
  return 'server'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function reasonKind(reason: unknown): GreenApiErrorKind {
  const text = typeof reason === 'string' ? reason : ''
  if (/limit reached/i.test(text)) return 'phoneCheckLimit'
  if (/starting|not authorized/i.test(text)) return 'notReady'
  return 'server'
}

// Long polling держит запрос до receiveTimeout; запас покрывает сеть и очередь сервера.
const RECEIVE_MARGIN_MS = 10_000
const REQUEST_TIMEOUT_MS = 15_000

export function createGreenApiClient(
  c: Credentials,
  fetchImpl: typeof fetch = globalThis.fetch,
): GreenApiClient {
  const apiUrl = normalizeApiUrl(c.apiUrl)
  if (!apiUrl) throw createGreenApiError('invalidApiUrl')
  const baseUrl = `${apiUrl}/waInstance${c.idInstance}`

  async function request<T>(
    method: string,
    signal?: AbortSignal,
    options: RequestOptions = {},
  ): Promise<T> {
    if (signal?.aborted) throw createGreenApiError('aborted')
    const timeout = new AbortController()
    const timer = setTimeout(
      () => timeout.abort(),
      options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    )
    const requestSignal = signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal
    let response: Response
    let text: string
    try {
      response = await fetchImpl(
        `${baseUrl}/${method}/${c.apiTokenInstance}${options.suffix ?? ''}`,
        {
          method: options.verb ?? 'GET',
          // Перенаправление не должно переносить URL с токеном на другой хост.
          redirect: 'error',
          signal: requestSignal,
          ...(options.body === undefined
            ? {}
            : {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(options.body),
              }),
        },
      )
      text = await response.text()
    } catch {
      // Исходная ошибка fetch может содержать URL с токеном.
      throw createGreenApiError(signal?.aborted ? 'aborted' : 'network')
    } finally {
      clearTimeout(timer)
    }
    if (signal?.aborted) throw createGreenApiError('aborted')
    if (!response.ok)
      throw createGreenApiError(
        httpErrorKind(response.status, text),
        response.status,
      )
    try {
      return JSON.parse(text) as T
    } catch {
      throw createGreenApiError('server', response.status)
    }
  }

  return {
    async getStateInstance(signal) {
      const response = await request<StateInstanceResponse>(
        'getStateInstance',
        signal,
      )
      if (typeof response?.stateInstance !== 'string')
        throw createGreenApiError('server')
      return response.stateInstance
    },
    async checkAccount(phone, signal) {
      const r = await request<Record<string, unknown> | null>(
        'checkAccount',
        signal,
        {
          verb: 'POST',
          body: { phoneNumber: phone },
        },
      )
      if (r?.exist === false) return { exist: false, chatId: '' }
      if (r?.exist === true && typeof r.chatId === 'string' && r.chatId)
        return { exist: true, chatId: r.chatId }
      throw createGreenApiError(reasonKind(r?.reason))
    },
    async checkWhatsapp(phone, signal) {
      const r = await request<Record<string, unknown> | null>(
        'checkWhatsapp',
        signal,
        {
          verb: 'POST',
          body: { phoneNumber: phone },
        },
      )
      if (typeof r?.existsWhatsapp === 'boolean')
        return { existsWhatsapp: r.existsWhatsapp }
      throw createGreenApiError(reasonKind(r?.reason))
    },
    sendMessage: (chatId, message, signal) =>
      request('sendMessage', signal, {
        verb: 'POST',
        body: { chatId, message },
      }),
    async receiveNotification(timeoutSec, signal) {
      const r = await request<unknown>('receiveNotification', signal, {
        suffix: `?receiveTimeout=${timeoutSec}`,
        timeoutMs: timeoutSec * 1000 + RECEIVE_MARGIN_MS,
      })
      if (r === null) return null
      if (!isRecord(r) || typeof r.receiptId !== 'number' || !isRecord(r.body))
        throw createGreenApiError('server')
      return { receiptId: r.receiptId, body: r.body }
    },
    async deleteNotification(receiptId, signal) {
      await request('deleteNotification', signal, {
        verb: 'DELETE',
        suffix: `/${receiptId}`,
      })
    },
  }
}
