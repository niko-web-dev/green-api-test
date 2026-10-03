import type {
  Credentials,
  ReceivedNotification,
  StateInstanceResponse,
  CheckAccountResponse,
  CheckWhatsappResponse,
  SendMessageResponse,
  DeleteNotificationResponse,
} from './types'

export type GreenApiErrorKind =
  | 'auth'
  | 'quota'
  | 'rateLimit'
  | 'webhookSet'
  | 'badRequest'
  | 'server'
  | 'network'
  | 'aborted'

const messages: Record<GreenApiErrorKind, string> = {
  auth: 'Не удалось авторизоваться. Проверьте учётные данные инстанса.',
  quota: 'Исчерпана квота GREEN-API. Проверьте ограничения тарифа.',
  rateLimit: 'Слишком много запросов. Попробуйте позже.',
  webhookSet:
    'Для получения уведомлений очистите webhookUrl в настройках инстанса.',
  badRequest: 'GREEN-API отклонил запрос. Проверьте переданные данные.',
  server: 'GREEN-API вернул ошибку сервера или некорректный ответ.',
  network: 'Не удалось связаться с GREEN-API. Проверьте подключение к сети.',
  aborted: 'Запрос отменён.',
}

export class GreenApiError extends Error {
  kind: GreenApiErrorKind
  status?: number

  constructor(kind: GreenApiErrorKind, status?: number) {
    super(messages[kind])
    this.name = 'GreenApiError'
    this.kind = kind
    this.status = status
  }
}

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
  deleteNotification(receiptId: number, signal?: AbortSignal): Promise<boolean>
}

function httpErrorKind(status: number, body: string): GreenApiErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 466) return 'quota'
  if (status === 429 || status === 469) return 'rateLimit'
  if (status === 400 && /webhook[\s_-]*url/i.test(body)) return 'webhookSet'
  if (status >= 400 && status < 500) return 'badRequest'
  return 'server'
}

export function createGreenApiClient(
  c: Credentials,
  fetchImpl: typeof fetch = globalThis.fetch,
): GreenApiClient {
  const baseUrl = `${c.apiUrl.replace(/\/+$/, '')}/waInstance${c.idInstance}`

  async function request<T>(
    method: string,
    signal?: AbortSignal,
    options: { verb?: string; body?: unknown; suffix?: string } = {},
  ): Promise<T> {
    if (signal?.aborted) throw new GreenApiError('aborted')
    let response: Response
    let text: string
    try {
      response = await fetchImpl(
        `${baseUrl}/${method}/${c.apiTokenInstance}${options.suffix ?? ''}`,
        {
          method: options.verb ?? 'GET',
          signal,
          ...(options.body === undefined
            ? {}
            : {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(options.body),
              }),
        },
      )
      text = await response.text()
    } catch (error) {
      // Токен находится в пути URL: исходные ошибки fetch и ответы API нельзя выводить пользователю.
      const aborted =
        signal?.aborted ||
        (typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          error.name === 'AbortError')
      throw new GreenApiError(aborted ? 'aborted' : 'network')
    }
    if (signal?.aborted) throw new GreenApiError('aborted')
    if (!response.ok)
      throw new GreenApiError(
        httpErrorKind(response.status, text),
        response.status,
      )
    try {
      return JSON.parse(text) as T
    } catch {
      throw new GreenApiError('server', response.status)
    }
  }

  return {
    async getStateInstance(signal) {
      const response = await request<StateInstanceResponse>(
        'getStateInstance',
        signal,
      )
      if (typeof response?.stateInstance !== 'string')
        throw new GreenApiError('server')
      return response.stateInstance
    },
    checkAccount: (phone, signal) =>
      request('checkAccount', signal, {
        verb: 'POST',
        body: { phoneNumber: phone },
      }),
    checkWhatsapp: (phone, signal) =>
      request('checkWhatsapp', signal, {
        verb: 'POST',
        body: { phoneNumber: phone },
      }),
    sendMessage: (chatId, message, signal) =>
      request('sendMessage', signal, {
        verb: 'POST',
        body: { chatId, message },
      }),
    receiveNotification: (timeoutSec, signal) =>
      request('receiveNotification', signal, {
        suffix: `?receiveTimeout=${timeoutSec}`,
      }),
    async deleteNotification(receiptId, signal) {
      const response = await request<DeleteNotificationResponse>(
        'deleteNotification',
        signal,
        {
          verb: 'DELETE',
          suffix: `/${receiptId}`,
        },
      )
      if (typeof response?.result !== 'boolean')
        throw new GreenApiError('server')
      return response.result
    },
  }
}
