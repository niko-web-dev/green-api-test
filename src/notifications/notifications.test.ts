import { describe, expect, it } from 'vitest'
import { parseNotification } from './notifications'
import type { IncomingText, OutgoingMessageStatus } from './types'

const fixtures = import.meta.glob<unknown>('../fixtures/*.json', {
  eager: true,
  import: 'default',
})

const title = 'Тестовый Получатель'
const expectedFixtures: Record<
  string,
  IncomingText | OutgoingMessageStatus | null
> = {
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
  'max.docs.incoming-quoted.json': {
    chatId: '10000002',
    idMessage: '1763115112345',
    text: 'Цитируем это',
    timestamp: 1588091580,
    chatName: title,
    typeInstance: 'v3',
  },
  'max.docs.check-account.json': null,
  'max.docs.send-message.json': null,
  'telegram.live.check-account.json': null,
  'telegram.live.send-message.json': null,
  'telegram.live.receive-empty.json': null,
  'telegram.live.outgoing-api-message.json': null,
  'telegram.live.outgoing-message-status.json': {
    chatId: '10000002',
    idMessage: '1790000000001',
    status: 'delivered',
    timestamp: 1790944922,
    typeInstance: 'telegram',
  },
  'telegram.live.outgoing-message-status-read.json': {
    chatId: '10000002',
    idMessage: '1790000000001',
    status: 'read',
    timestamp: 1790944928,
    typeInstance: 'telegram',
  },
  'whatsapp.live.check-account.json': null,
  'whatsapp.live.send-message.json': null,
  'whatsapp.live.receive-empty.json': null,
  'whatsapp.live.outgoing-api-message.json': null,
  'whatsapp.live.outgoing-message-status.json': {
    chatId: '79990000002@c.us',
    idMessage: '3EB0000000000000000001',
    status: 'delivered',
    timestamp: 1791014912,
    typeInstance: 'whatsapp',
  },
  'whatsapp.live.outgoing-message-status-sent.json': {
    chatId: '79990000002@c.us',
    idMessage: '3EB0000000000000000001',
    status: 'sent',
    timestamp: 1791014908,
    typeInstance: 'whatsapp',
  },
  'whatsapp.live.outgoing-message-status-read.json': {
    chatId: '79990000002@c.us',
    idMessage: '3EB0000000000000000001',
    status: 'read',
    timestamp: 1791014951,
    typeInstance: 'whatsapp',
  },
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
    expect(parseNotification(body)).toEqual(expectedFixtures[name])
  })
})

describe('Разбор уведомлений', () => {
  it.each(['-10000002', '-10000002@g.us', '79990000002@g.us'])(
    'игнорирует группу %s',
    (chatId) => {
      const body = validBody()
      body.senderData.chatId = chatId
      expect(parseNotification(body)).toBeNull()
    },
  )
  it.each(['outgoingMessageReceived', 'stateInstanceChanged'])(
    'игнорирует событие %s',
    (typeWebhook) => {
      expect(parseNotification({ ...validBody(), typeWebhook })).toBeNull()
    },
  )
  it.each([undefined, null, 42, 'текст', [], {}])(
    'игнорирует сломанное тело %j',
    (body) => {
      expect(parseNotification(body)).toBeNull()
    },
  )
  it.each([
    { senderData: undefined },
    { senderData: { chatId: '' } },
    { idMessage: undefined },
    { timestamp: '1790944940' },
    { timestamp: -1 },
    { instanceData: {} },
    { messageData: { typeMessage: 'textMessage' } },
    {
      messageData: {
        typeMessage: 'textMessage',
        textMessageData: { textMessage: 42 },
      },
    },
  ])('отклоняет неверное поле %#', (patch) => {
    expect(parseNotification({ ...validBody(), ...patch })).toBeNull()
  })
  it.each([
    ['Название', 'Отправитель', 'Название'],
    ['', 'Отправитель', 'Отправитель'],
    ['', '', '10000002'],
  ])('выбирает имя чата %#', (chatName, senderName, expected) => {
    const parsed = parseNotification({
      ...validBody(),
      senderData: { chatId: '10000002', chatName, senderName },
    })
    expect(parsed && 'chatName' in parsed ? parsed.chatName : undefined).toBe(
      expected,
    )
  })
  it.each(['imageMessage', 'unknown'])('игнорирует тип %s', (typeMessage) => {
    expect(parseNotification(validBody(typeMessage))).toBeNull()
  })
})

describe('Разбор статусов доставки', () => {
  const body = {
    typeWebhook: 'outgoingMessageStatus',
    chatId: '10000002',
    idMessage: 'message-1',
    status: 'sent',
    timestamp: 1790944940,
    instanceData: { typeInstance: 'telegram' },
  }

  it.each(['sent', 'delivered', 'read'])('распознаёт статус %s', (status) => {
    expect(parseNotification({ ...body, status })).toEqual({
      chatId: body.chatId,
      idMessage: body.idMessage,
      status,
      timestamp: body.timestamp,
      typeInstance: 'telegram',
    })
  })

  it.each([
    { chatId: undefined },
    { chatId: '' },
    { chatId: '   ' },
    { chatId: 123 },
    { idMessage: null },
    { idMessage: '' },
    { idMessage: '   ' },
    { idMessage: 123 },
    { status: undefined },
    { status: 123 },
    { status: 'failed' },
    { status: 'unknown' },
    { status: 'READ' },
    { status: ' read ' },
    { timestamp: undefined },
    { timestamp: '123' },
    { timestamp: -1 },
    { timestamp: NaN },
    { timestamp: Infinity },
    { instanceData: null },
    { instanceData: [] },
    { instanceData: {} },
    { instanceData: { typeInstance: '' } },
    { instanceData: { typeInstance: '   ' } },
    { instanceData: { typeInstance: 123 } },
  ])('отклоняет повреждённое поле %#', (patch) => {
    expect(parseNotification({ ...body, ...patch })).toBeNull()
  })

  it('принимает нулевую временную отметку', () => {
    expect(parseNotification({ ...body, timestamp: 0 })).not.toBeNull()
  })
})
