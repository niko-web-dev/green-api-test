import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGreenApiClient, GreenApiError } from './greenApiClient'
import type { GreenApiErrorKind } from './greenApiClient'
import type { Credentials } from './types'
import maxAccount from '../test/fixtures/max.docs.check-account.json'
import telegramAccount from '../test/fixtures/telegram.live.check-account.json'
import whatsappAccount from '../test/fixtures/whatsapp.live.check-account.json'
import maxSent from '../test/fixtures/max.docs.send-message.json'
import telegramSent from '../test/fixtures/telegram.live.send-message.json'
import whatsappSent from '../test/fixtures/whatsapp.live.send-message.json'
import telegramEmpty from '../test/fixtures/telegram.live.receive-empty.json'
import whatsappEmpty from '../test/fixtures/whatsapp.live.receive-empty.json'

const credentials: Credentials = {
  apiUrl: 'https://example.test',
  idInstance: '0000000000',
  apiTokenInstance: 'TEST_ONLY_SECRET_DO_NOT_DISPLAY',
}
const prefix = `${credentials.apiUrl}/waInstance${credentials.idInstance}`
const token = credentials.apiTokenInstance
const phone = 79990000002
const notificationFixtures = import.meta.glob('../test/fixtures/*.json', {
  eager: true,
  import: 'default',
})

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
  expect(error.message).toMatch(/[А-Яа-я]/)
  expect(error.message).not.toContain(token)
  expect(error.message).not.toContain(credentials.apiUrl)
  expect(error.message).not.toMatch(/https?:\/\//)
  expect(error.cause).toBeUndefined()
}

afterEach(() => vi.unstubAllGlobals())

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
          signal: undefined,
        },
      )
    },
  )

  it('использует глобальный fetch по умолчанию', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ stateInstance: 'notAuthorized' }))
    vi.stubGlobal('fetch', fetchImpl)
    expect(await createGreenApiClient(credentials).getStateInstance()).toBe(
      'notAuthorized',
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('передаёт метод, JSON и сигнал для каждого вызова', async () => {
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
    expect(await client.deleteNotification(1650, signal)).toBe(true)
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
          signal,
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

  it.each([maxAccount, telegramAccount])(
    'разбирает ответ проверки аккаунта %#',
    async (fixture) => {
      const client = createGreenApiClient(
        credentials,
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(fixture)),
      )
      expect(await client.checkAccount(phone)).toEqual(fixture)
    },
  )

  it('разбирает ответ проверки WhatsApp без потери дополнительных полей', async () => {
    const client = createGreenApiClient(
      credentials,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(whatsappAccount)),
    )
    expect(await client.checkWhatsapp(phone)).toEqual(whatsappAccount)
  })

  it.each([maxSent, telegramSent, whatsappSent])(
    'разбирает ответ отправки %#',
    async (fixture) => {
      const client = createGreenApiClient(
        credentials,
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(fixture)),
      )
      expect(await client.sendMessage('10000002', 'Текст')).toEqual(fixture)
    },
  )

  it.each(
    Object.entries(notificationFixtures).filter(([name]) =>
      /incoming-|outgoing-/.test(name),
    ),
  )('возвращает сырое уведомление из %s', async (name, fixture) => {
    const response = name.includes('max.docs')
      ? { receiptId: 1, body: fixture }
      : fixture
    const client = createGreenApiClient(
      credentials,
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response)),
    )
    expect(await client.receiveNotification(20)).toEqual(response)
  })

  it.each([telegramEmpty, whatsappEmpty])(
    'возвращает null на пустую очередь %#',
    async (fixture) => {
      const client = createGreenApiClient(
        credentials,
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(fixture)),
      )
      expect(await client.receiveNotification(20)).toBeNull()
    },
  )

  it('сохраняет отрицательные ответы API', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ exist: false, chatId: '' }))
      .mockResolvedValueOnce(jsonResponse({ existsWhatsapp: false }))
      .mockResolvedValueOnce(jsonResponse({ result: false }))
    const client = createGreenApiClient(credentials, fetchImpl)
    expect(await client.checkAccount(phone)).toEqual({
      exist: false,
      chatId: '',
    })
    expect(await client.checkWhatsapp(phone)).toEqual({ existsWhatsapp: false })
    expect(await client.deleteNotification(1)).toBe(false)
  })

  it.each<[number, string, GreenApiErrorKind]>([
    [401, token, 'auth'],
    [403, token, 'auth'],
    [466, token, 'quota'],
    [429, token, 'rateLimit'],
    [469, token, 'rateLimit'],
    [400, `Webhook URL is set ${token}`, 'webhookSet'],
    [400, `webhookUrl ${token}`, 'webhookSet'],
    [400, token, 'badRequest'],
    [404, token, 'badRequest'],
    [422, token, 'badRequest'],
    [500, token, 'server'],
    [503, token, 'server'],
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

  it('обрабатывает HTTP 400 с пустым телом как отклонённый запрос', async () => {
    const client = createGreenApiClient(
      credentials,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('', { status: 400 })),
    )
    await expectSafeError(client.deleteNotification(1), 'badRequest', 400)
  })

  it.each([
    [new TypeError(`Failed to fetch ${prefix}/${token}`), 'network'],
    [new DOMException(token, 'AbortError'), 'aborted'],
    [new Error(token), 'network'],
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

  it('не вызывает fetch при заранее отменённом сигнале с произвольной причиной', async () => {
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

  it('обрабатывает отмену во время чтения тела ответа', async () => {
    const controller = new AbortController()
    const response = jsonResponse(null)
    vi.spyOn(response, 'text').mockImplementation(async () => {
      controller.abort()
      throw new DOMException(token, 'AbortError')
    })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response)
    await expectSafeError(
      createGreenApiClient(credentials, fetchImpl).receiveNotification(
        20,
        controller.signal,
      ),
      'aborted',
    )
  })

  it.each(['', `invalid ${token}`])(
    'не выдаёт текст некорректного JSON %#',
    async (body) => {
      const client = createGreenApiClient(
        credentials,
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      )
      await expectSafeError(client.receiveNotification(20), 'server', 200)
    },
  )

  it.each([null, {}])(
    'не выдаёт необработанную ошибку при неверном ответе состояния %#',
    async (body) => {
      const client = createGreenApiClient(
        credentials,
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)),
      )
      await expectSafeError(client.getStateInstance(), 'server')
    },
  )
})
