import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGreenApiClient,
  GreenApiError,
  describeError,
} from './greenApiClient'
import type { GreenApiErrorKind } from './greenApiClient'
import type { Credentials } from './types'
import maxAccount from '../test/fixtures/max.docs.check-account.json'
import whatsappAccount from '../test/fixtures/whatsapp.live.check-account.json'
import maxSent from '../test/fixtures/max.docs.send-message.json'
import telegramEmpty from '../test/fixtures/telegram.live.receive-empty.json'

const credentials: Credentials = {
  apiUrl: 'https://example.test',
  idInstance: '0000000000',
  apiTokenInstance: 'TEST_ONLY_SECRET_DO_NOT_DISPLAY',
}
const prefix = `${credentials.apiUrl}/waInstance${credentials.idInstance}`
const token = credentials.apiTokenInstance
const phone = 79990000002
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

async function expectSafeError(
  promise: Promise<unknown>,
  kind: GreenApiErrorKind,
  status?: number,
) {
  const error: unknown = await promise.catch((reason: unknown) => reason)
  expect(error).toBeInstanceOf(GreenApiError)
  if (!(error instanceof GreenApiError))
    throw new Error('Ожидалась ошибка GREEN-API')
  expect(error.kind).toBe(kind)
  expect(error.status).toBe(status)
  expect(error.message).not.toContain(token)
  expect(error.message).not.toContain(credentials.apiUrl)
  expect(error.cause).toBeUndefined()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('HTTP-клиент', () => {
  it.each(['', '/', '///'])(
    'собирает URL при завершающем слэше «%s»',
    async (slash) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ stateInstance: 'authorized' }))
      const client = createGreenApiClient(
        { ...credentials, apiUrl: credentials.apiUrl + slash },
        fetchImpl,
      )
      expect(await client.getStateInstance()).toBe('authorized')
      expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
        `${prefix}/getStateInstance/${token}`,
        {
          method: 'GET',
          signal: expect.any(AbortSignal),
        },
      )
    },
  )

  it('передаёт метод, JSON и сигнал', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ stateInstance: 'authorized' }))
      .mockResolvedValueOnce(jsonResponse(maxAccount))
      .mockResolvedValueOnce(jsonResponse(whatsappAccount))
      .mockResolvedValueOnce(jsonResponse(maxSent))
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(jsonResponse({ result: true }))
    const client = createGreenApiClient(credentials, fetchImpl)
    const signal = new AbortController().signal
    await client.getStateInstance(signal)
    await client.checkAccount(phone, signal)
    await client.checkWhatsapp(phone, signal)
    await client.sendMessage('10000002', 'Текст сообщения', signal)
    await client.receiveNotification(20, signal)
    await client.deleteNotification(1650, signal)
    const calls: [string, string, unknown?, string?][] = [
      ['getStateInstance', 'GET'],
      ['checkAccount', 'POST', { phoneNumber: phone }],
      ['checkWhatsapp', 'POST', { phoneNumber: phone }],
      [
        'sendMessage',
        'POST',
        { chatId: '10000002', message: 'Текст сообщения' },
      ],
      ['receiveNotification', 'GET', undefined, '?receiveTimeout=20'],
      ['deleteNotification', 'DELETE', undefined, '/1650'],
    ]
    calls.forEach(([method, verb, body, suffix = ''], index) => {
      expect(fetchImpl).toHaveBeenNthCalledWith(
        index + 1,
        `${prefix}/${method}/${token}${suffix}`,
        {
          method: verb,
          signal: expect.any(AbortSignal),
          ...(body === undefined
            ? {}
            : {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }),
        },
      )
    })
    expect(fetchImpl).toHaveBeenCalledTimes(6)
  })

  it.each([telegramEmpty])(
    'возвращает null на пустую очередь %#',
    async (fixture) => {
      const client = createGreenApiClient(
        credentials,
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(fixture)),
      )
      expect(await client.receiveNotification(20)).toBeNull()
    },
  )

  it.each<[number, string, GreenApiErrorKind]>([
    [401, token, 'auth'],
    [403, token, 'auth'],
    [408, token, 'network'],
    [466, token, 'quota'],
    [429, token, 'rateLimit'],
    [469, token, 'phoneCheckLimit'],
    [
      400,
      `Message cannot be received because custom webhook url is set ${token}`,
      'webhookSet',
    ],
    [400, 'instance in starting process try later', 'notReady'],
    [400, 'instance is starting or not authorized', 'notReady'],
    [400, token, 'badRequest'],
    [499, token, 'network'],
    [500, token, 'server'],
  ])('отображает HTTP %s как безопасную ошибку', async (status, body, kind) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(`${credentials.apiUrl} ${body}`, { status }),
      )
    await expectSafeError(
      createGreenApiClient(credentials, fetchImpl).receiveNotification(20),
      kind,
      status,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([
    [new TypeError(`Failed to fetch ${prefix}/${token}`), 'network'],
    [new DOMException(token, 'AbortError'), 'network'],
  ] as const)('скрывает исходную ошибку запроса %#', async (error, kind) => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(error)
    await expectSafeError(
      createGreenApiClient(credentials, fetchImpl).sendMessage(
        '10000002',
        'Текст',
      ),
      kind,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('заранее отменённый запрос не запускается', async () => {
    const controller = new AbortController()
    controller.abort(token)
    const fetchImpl = vi.fn<typeof fetch>()
    await expectSafeError(
      createGreenApiClient(credentials, fetchImpl).receiveNotification(
        20,
        controller.signal,
      ),
      'aborted',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('обрабатывает отмену во время запроса', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException(token, 'AbortError')),
            { once: true },
          )
        }),
    )
    const result = createGreenApiClient(
      credentials,
      fetchImpl,
    ).receiveNotification(20, controller.signal)
    controller.abort()
    await expectSafeError(result, 'aborted')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('отбрасывает поздний ответ после отмены', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort(token)
      return jsonResponse(null)
    })
    await expectSafeError(
      createGreenApiClient(credentials, fetchImpl).receiveNotification(
        20,
        controller.signal,
      ),
      'aborted',
    )
  })

  it.each([`invalid ${token}`])(
    'не выдаёт текст некорректного JSON %#',
    async (body) => {
      const client = createGreenApiClient(
        credentials,
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      )
      await expectSafeError(client.receiveNotification(20), 'server', 200)
    },
  )

  it.each([{}])('отклоняет неверное состояние %#', async (body) => {
    const client = createGreenApiClient(
      credentials,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)),
    )
    await expectSafeError(client.getStateInstance(), 'server')
  })

  it('тайм-аут receive даёт network', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('', 'AbortError')),
            { once: true },
          )
        }),
    )
    const checked = expectSafeError(
      createGreenApiClient(credentials, fetchImpl).receiveNotification(20),
      'network',
    )
    await vi.advanceTimersByTimeAsync(29_999)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await checked
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ответ очищает таймер запроса', async () => {
    vi.useFakeTimers()
    const client = createGreenApiClient(
      credentials,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(null)),
    )
    await client.receiveNotification(20)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([{ result: false }, {}])(
    'delete не требует result %#',
    async (body) => {
      const client = createGreenApiClient(
        credentials,
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)),
      )
      await expect(client.deleteNotification(1)).resolves.toBeUndefined()
    },
  )

  it.each([
    [
      'checkAccount',
      { status: false, reason: 'User get contact info limit reached' },
      'phoneCheckLimit',
    ],
    [
      'checkAccount',
      { status: false, reason: 'instance is starting or not authorized' },
      'notReady',
    ],
    ['checkAccount', {}, 'server'],
    ['checkAccount', { exist: true, chatId: '' }, 'server'],
    [
      'checkWhatsapp',
      { status: false, reason: 'User get contact info limit reached' },
      'phoneCheckLimit',
    ],
    [
      'checkWhatsapp',
      { status: false, reason: 'instance is starting or not authorized' },
      'notReady',
    ],
    ['checkWhatsapp', {}, 'server'],
  ] as const)('отклоняет некорректный %s %#', async (method, body, kind) => {
    const client = createGreenApiClient(
      credentials,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)),
    )
    await expectSafeError(client[method](phone), kind)
  })

  it('нормализует отсутствие аккаунта', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ exist: false, chatId: '' }))
      .mockResolvedValueOnce(jsonResponse({ existsWhatsapp: false }))
    const client = createGreenApiClient(credentials, fetchImpl)
    expect(await client.checkAccount(phone)).toEqual({
      exist: false,
      chatId: '',
    })
    expect(await client.checkWhatsapp(phone)).toEqual({ existsWhatsapp: false })
  })

  it.each([{}, { receiptId: '1', body: {} }])(
    'отклоняет повреждённую очередь %#',
    async (body) => {
      const client = createGreenApiClient(
        credentials,
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)),
      )
      await expectSafeError(client.receiveNotification(20), 'server')
    },
  )

  it('диагностика игнорирует подменённый message', () => {
    const error = new GreenApiError('badRequest', 400)
    error.message = token
    expect(describeError(error)).toBe(
      'GREEN-API отклонил запрос. Проверьте переданные данные. (HTTP 400)',
    )
    expect(describeError(new Error(token))).toBe(
      'Не удалось выполнить запрос к GREEN-API.',
    )
  })
})
