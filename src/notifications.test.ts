import { describe, expect, it } from 'vitest'
import type { NotificationBody } from './api/types'
import { parseNotification } from './notifications'
import type { IncomingText } from './notifications'

const fixtures = import.meta.glob<unknown>('./test/fixtures/*.json', {
  eager: true,
  import: 'default',
})

const title = 'Тестовый Получатель'
const expectedFixtures: Record<string, IncomingText | null> = {
  'max.docs.incoming-text.json': {
    chatId: '10000002',
    idMessage: '1763115112345',
    text: 'Я использую GREEN-API для отправки этого сообщения!',
    timestamp: 1763115112,
    chatName: title,
    typeInstance: 'v3',
  },
  'max.docs.incoming-extended-text.json': {
    chatId: '10000002',
    idMessage: '1763115112345',
    text: 'Я использую GREEN-API для отправки этого сообщения! Документация на сайте https://green-api.com/',
    timestamp: 1763115112,
    chatName: title,
    typeInstance: 'v3',
  },
  'telegram.live.incoming-text.json': {
    chatId: '10000002',
    idMessage: '1790000000002',
    text: 'принято',
    timestamp: 1790944940,
    chatName: title,
    typeInstance: 'telegram',
  },
  'telegram.live.incoming-text-link.json': {
    chatId: '10000002',
    idMessage: '1790000000003',
    text: 'https://example.com',
    timestamp: 1790944947,
    chatName: title,
    typeInstance: 'telegram',
  },
  'whatsapp.live.incoming-text.json': {
    chatId: '79990000002@c.us',
    idMessage: '3A00000000000000000002',
    text: 'принято',
    timestamp: 1791014958,
    chatName: title,
    typeInstance: 'whatsapp',
  },
  'whatsapp.live.incoming-extended-text.json': {
    chatId: '79990000002@c.us',
    idMessage: '3A00000000000000000003',
    text: 'https://example.com',
    timestamp: 1791015008,
    chatName: title,
    typeInstance: 'whatsapp',
  },
  'max.docs.check-account.json': null,
  'max.docs.send-message.json': null,
  'telegram.live.check-account.json': null,
  'telegram.live.send-message.json': null,
  'telegram.live.receive-empty.json': null,
  'telegram.live.outgoing-api-message.json': null,
  'telegram.live.outgoing-message-status.json': null,
  'telegram.live.outgoing-message-status-read.json': null,
  'whatsapp.live.check-account.json': null,
  'whatsapp.live.send-message.json': null,
  'whatsapp.live.receive-empty.json': null,
  'whatsapp.live.outgoing-api-message.json': null,
  'whatsapp.live.outgoing-message-status.json': null,
  'whatsapp.live.outgoing-message-status-sent.json': null,
  'whatsapp.live.outgoing-message-status-read.json': null,
}

function parseRaw(body: unknown) {
  return parseNotification(body as NotificationBody)
}

function validBody(typeMessage = 'textMessage') {
  return {
    typeWebhook: 'incomingMessageReceived',
    instanceData: { typeInstance: 'telegram' },
    idMessage: 'message-1',
    timestamp: 1790944940,
    senderData: {
      chatId: '10000002',
      chatName: 'Название',
      senderName: 'Отправитель',
    },
    messageData: {
      typeMessage,
      ...(typeMessage === 'textMessage'
        ? { textMessageData: { textMessage: 'Текст' } }
        : { extendedTextMessageData: { text: 'Текст' } }),
    },
  }
}

describe('Фикстуры уведомлений', () => {
  it('содержит явные ожидания для всех сохранённых ответов', () => {
    const names = Object.keys(fixtures).map((path) => path.split('/').at(-1))
    expect(names.sort()).toEqual(Object.keys(expectedFixtures).sort())
  })

  it.each(Object.entries(fixtures))('разбирает %s', (path, fixture) => {
    const name = path.split('/').at(-1)!
    const body =
      fixture && typeof fixture === 'object' && 'body' in fixture
        ? fixture.body
        : fixture
    expect(parseRaw(body)).toEqual(expectedFixtures[name])
  })
})

const brokenValues: unknown[] = [undefined, null, false, 42, [], {}]
const invalidStrings: unknown[] = [...brokenValues, '', '   ']
const invalidTimestamps: unknown[] = [
  undefined,
  null,
  false,
  '1790944940',
  [],
  {},
  NaN,
  Infinity,
  -Infinity,
  -1,
]

describe.each(['textMessage', 'extendedTextMessage'])(
  'Разбор %s',
  (typeMessage) => {
    it.each(['-10000002', '-10000002@g.us', '79990000002@g.us'])(
      'игнорирует групповой чат %s',
      (chatId) => {
        const body = validBody(typeMessage)
        body.senderData.chatId = chatId
        expect(parseNotification(body)).toBeNull()
      },
    )

    it.each([
      'outgoingMessageReceived',
      'outgoingAPIMessageReceived',
      'outgoingMessageStatus',
      'stateInstanceChanged',
      'unknown',
      '',
      ...brokenValues,
    ])('игнорирует неподдерживаемый typeWebhook %j', (typeWebhook) => {
      expect(parseRaw({ ...validBody(typeMessage), typeWebhook })).toBeNull()
    })

    const dataKey =
      typeMessage === 'textMessage'
        ? 'textMessageData'
        : 'extendedTextMessageData'
    const textKey = typeMessage === 'textMessage' ? 'textMessage' : 'text'
    const invalidFields: [string[], unknown[]][] = [
      [['instanceData'], brokenValues],
      [['senderData'], brokenValues],
      [['messageData'], brokenValues],
      [['idMessage'], invalidStrings],
      [['timestamp'], invalidTimestamps],
      [['instanceData', 'typeInstance'], invalidStrings],
      [['senderData', 'chatId'], invalidStrings],
      [
        ['senderData', 'chatName'],
        brokenValues.filter((value) => value !== undefined),
      ],
      [
        ['senderData', 'senderName'],
        brokenValues.filter((value) => value !== undefined),
      ],
      [['messageData', 'typeMessage'], invalidStrings],
      [['messageData', dataKey], brokenValues],
      [['messageData', dataKey, textKey], brokenValues],
    ]
    const cases = invalidFields.flatMap(([path, values]) =>
      values.map((value) => ({ field: path.join('.'), path, value })),
    )

    it.each(cases)(
      'возвращает null без исключения: $field = $value',
      ({ path, value }) => {
        const body = validBody(typeMessage)
        let parent = body as Record<string, unknown>
        for (const key of path.slice(0, -1))
          parent = parent[key] as Record<string, unknown>
        const key = path.at(-1)!
        if (value === undefined) delete parent[key]
        else parent[key] = value
        expect(() => parseRaw(body)).not.toThrow()
        expect(parseRaw(body)).toBeNull()
      },
    )

    it.each([
      ['Название', 'Отправитель', 'Название'],
      ['', 'Отправитель', 'Отправитель'],
      [undefined, 'Отправитель', 'Отправитель'],
      ['', '', '10000002'],
      [undefined, undefined, '10000002'],
    ])('выбирает имя чата: %j / %j', (chatName, senderName, expected) => {
      const body = validBody(typeMessage)
      expect(
        parseRaw({
          ...body,
          senderData: { chatId: '10000002', chatName, senderName },
        })?.chatName,
      ).toBe(expected)
    })

    it.each(['', '  ', ' строка\n🙂 https://example.com '])(
      'сохраняет текст без преобразований %j',
      (text) => {
        const body = validBody(typeMessage)
        expect(
          parseRaw({
            ...body,
            messageData: { typeMessage, [dataKey]: { [textKey]: text } },
          })?.text,
        ).toBe(text)
      },
    )

    it('не меняет исходное уведомление и одинаково разбирает повтор', () => {
      const body = validBody(typeMessage)
      const before = JSON.stringify(body)
      expect(parseNotification(body)).toEqual(parseNotification(body))
      expect(JSON.stringify(body)).toBe(before)
    })

    it('сохраняет нулевую временную метку и неизвестный строковый typeInstance', () => {
      const body = validBody(typeMessage)
      body.timestamp = 0
      body.instanceData.typeInstance = 'new-messenger'
      expect(parseNotification(body)).toMatchObject({
        timestamp: 0,
        typeInstance: 'new-messenger',
      })
    })
  },
)

describe('Неподдерживаемые данные', () => {
  it.each([...brokenValues, 'текст'])(
    'не выбрасывает исключение для тела %j',
    (body) => {
      expect(() => parseRaw(body)).not.toThrow()
      expect(parseRaw(body)).toBeNull()
    },
  )

  it.each([
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'locationMessage',
    'contactMessage',
    'stickerMessage',
    'unknown',
  ])('игнорирует тип сообщения %s даже при наличии текста', (typeMessage) => {
    const body = validBody()
    body.messageData.typeMessage = typeMessage
    expect(parseNotification(body)).toBeNull()
  })

  it.each(['textMessage', 'extendedTextMessage'])(
    'не использует текст из другого формата для %s',
    (typeMessage) => {
      const body = validBody(typeMessage)
      body.messageData = validBody(
        typeMessage === 'textMessage' ? 'extendedTextMessage' : 'textMessage',
      ).messageData
      body.messageData.typeMessage = typeMessage
      expect(parseNotification(body)).toBeNull()
    },
  )
})
