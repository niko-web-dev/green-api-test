import { describe, expect, it } from 'vitest'
import type { DeliveryStatus } from '../notifications/types'
import reducer, { messageStatusUpdated, outgoingStarted } from './chatsSlice'
import { loggedOut } from './sessionSlice'
import { sendMessage } from './thunks'
import type { Message } from './types'

function stateWithMessage(
  status: Message['status'] = 'sent',
  direction: Message['direction'] = 'out',
) {
  return reducer(
    undefined,
    outgoingStarted({
      sessionId: 1,
      message: {
        key: 'local-key',
        chatId: '10000002',
        idMessage: 'message-1',
        direction,
        text: 'Текст',
        timestamp: 1,
        status,
      },
    }),
  )
}

describe('Обновление статусов доставки', () => {
  it('сопоставляет ранние статусы параллельных отправок при обратном порядке ответов', () => {
    let state = reducer(undefined, { type: 'init' })
    for (const key of ['first', 'second'])
      state = reducer(
        state,
        outgoingStarted({
          sessionId: 1,
          message: {
            key,
            chatId: '10000002',
            direction: 'out',
            text: key,
            timestamp: 1,
            status: 'sending',
          },
        }),
      )
    for (const [idMessage, status] of [
      ['first-id', 'read'],
      ['first-id', 'sent'],
      ['second-id', 'noAccount'],
      ['second-id', 'sent'],
    ] as const)
      state = reducer(
        state,
        messageStatusUpdated({ chatId: '10000002', idMessage, status }),
      )
    expect(state.pendingStatuses).toHaveLength(2)
    for (const key of ['second', 'first']) {
      state = reducer(
        state,
        sendMessage.fulfilled(
          { chatId: '10000002', key, idMessage: `${key}-id` },
          key,
          { sessionId: 1, chatId: '10000002', text: key },
        ),
      )
      if (key === 'second')
        expect(state.pendingStatuses).toEqual([
          { chatId: '10000002', idMessage: 'first-id', status: 'read' },
        ])
    }
    expect(state.messagesByChat['10000002']).toMatchObject([
      { key: 'first', status: 'read' },
      {
        key: 'second',
        status: 'failed',
        error: expect.stringContaining('Получатель недоступен'),
      },
    ])
    expect(state.pendingStatuses).toEqual([])
  })

  it('ошибка отправки не откатывает подтверждённую доставку, а sent не снимает ошибку', () => {
    let state = reducer(
      stateWithMessage(),
      messageStatusUpdated({
        chatId: '10000002',
        idMessage: 'message-1',
        status: 'noAccount',
      }),
    )
    expect(state.messagesByChat['10000002']![0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Получатель недоступен'),
    })
    state = reducer(
      state,
      messageStatusUpdated({
        chatId: '10000002',
        idMessage: 'message-1',
        status: 'sent',
      }),
    )
    expect(state.messagesByChat['10000002']![0]!.status).toBe('failed')
    state = reducer(
      state,
      messageStatusUpdated({
        chatId: '10000002',
        idMessage: 'message-1',
        status: 'delivered',
      }),
    )
    state = reducer(
      state,
      messageStatusUpdated({
        chatId: '10000002',
        idMessage: 'message-1',
        status: 'failed',
      }),
    )
    expect(state.messagesByChat['10000002']![0]).toMatchObject({
      status: 'delivered',
    })
    expect(state.messagesByChat['10000002']![0]!.error).toBeUndefined()
  })

  it('не применяет статус из другого чата', () => {
    const initial = stateWithMessage()
    expect(
      reducer(
        initial,
        messageStatusUpdated({
          chatId: 'other-chat',
          idMessage: 'message-1',
          status: 'read',
        }),
      ),
    ).toBe(initial)
  })

  it('ограничивает ранние статусы и очищает их после завершения и выхода', () => {
    let state = reducer(
      undefined,
      outgoingStarted({
        sessionId: 1,
        message: {
          key: 'local-key',
          chatId: '10000002',
          direction: 'out',
          text: 'Текст',
          timestamp: 1,
          status: 'sending',
        },
      }),
    )
    for (let i = 0; i <= 100; i++)
      state = reducer(
        state,
        messageStatusUpdated({
          chatId: '10000002',
          idMessage: `pending-${i}`,
          status: 'read',
        }),
      )
    expect(state.pendingStatuses).toHaveLength(100)
    expect(
      state.pendingStatuses.some((event) => event.idMessage === 'pending-0'),
    ).toBe(false)
    expect(reducer(state, loggedOut()).pendingStatuses).toEqual([])
    state = reducer(
      state,
      sendMessage.fulfilled(
        { chatId: '10000002', key: 'local-key', idMessage: 'pending-100' },
        'local-key',
        { sessionId: 1, chatId: '10000002', text: 'Текст' },
      ),
    )
    expect(state.pendingStatuses).toEqual([])
    expect(state.messagesByChat['10000002']![0]!.status).toBe('read')
  })

  it('повтор не наследует idMessage предыдущей попытки', () => {
    const initial = reducer(
      stateWithMessage(),
      messageStatusUpdated({
        chatId: '10000002',
        idMessage: 'message-1',
        status: 'failed',
      }),
    )
    let state = reducer(
      initial,
      outgoingStarted({
        sessionId: 1,
        retryKey: 'local-key',
        message: {
          key: 'local-key',
          chatId: '10000002',
          direction: 'out',
          text: 'Текст',
          timestamp: 2,
          status: 'sending',
        },
      }),
    )
    expect(state.messagesByChat['10000002']![0]!.idMessage).toBeUndefined()
    state = reducer(
      state,
      messageStatusUpdated({
        chatId: '10000002',
        idMessage: 'message-1',
        status: 'read',
      }),
    )
    expect(state.messagesByChat['10000002']![0]!.status).toBe('sending')
    state = reducer(
      state,
      sendMessage.fulfilled(
        { chatId: '10000002', key: 'local-key', idMessage: 'message-2' },
        'new-request',
        {
          sessionId: 1,
          chatId: '10000002',
          text: 'Текст',
          retryKey: 'local-key',
        },
      ),
    )
    expect(state.messagesByChat['10000002']![0]).toMatchObject({
      status: 'sent',
      idMessage: 'message-2',
    })
    expect(state.pendingStatuses).toEqual([])
  })

  it.each(['read', 'failed', 'noAccount'] as const)(
    'применяет ранний %s после подтверждения отправки',
    (status) => {
      let state = reducer(
        undefined,
        outgoingStarted({
          sessionId: 1,
          message: {
            key: 'local-key',
            chatId: '10000002',
            direction: 'out',
            text: 'Текст',
            timestamp: 1,
            status: 'sending',
          },
        }),
      )
      state = reducer(
        state,
        messageStatusUpdated({
          sessionId: 1,
          chatId: '10000002',
          idMessage: 'message-1',
          status,
        }),
      )
      state = reducer(
        state,
        sendMessage.fulfilled(
          { chatId: '10000002', key: 'local-key', idMessage: 'message-1' },
          'local-key',
          { sessionId: 1, chatId: '10000002', text: 'Текст' },
        ),
      )
      expect(state.messagesByChat['10000002']![0]!.status).toBe(
        status === 'read' ? 'read' : 'failed',
      )
    },
  )

  it.each([
    ['sending', 'sent', 'sent'],
    ['failed', 'delivered', 'delivered'],
    ['unknown', 'read', 'read'],
    ['sent', 'sent', 'sent'],
    ['sent', 'delivered', 'delivered'],
    ['sent', 'read', 'read'],
    ['delivered', 'sent', 'delivered'],
    ['delivered', 'delivered', 'delivered'],
    ['delivered', 'read', 'read'],
    ['read', 'sent', 'read'],
    ['read', 'delivered', 'read'],
    ['read', 'read', 'read'],
  ] as const)('переход %s → %s сохраняет %s', (initial, next, expected) => {
    const state = reducer(
      stateWithMessage(initial),
      messageStatusUpdated({
        chatId: '10000002',
        idMessage: 'message-1',
        status: next,
      }),
    )
    expect(state.messagesByChat['10000002']![0]!.status).toBe(expected)
  })

  it('повторы и перестановка уведомлений не откатывают статус', () => {
    let state = stateWithMessage()
    for (const status of [
      'read',
      'delivered',
      'sent',
      'read',
    ] as DeliveryStatus[])
      state = reducer(
        state,
        messageStatusUpdated({
          chatId: '10000002',
          idMessage: 'message-1',
          status,
        }),
      )
    expect(state.messagesByChat['10000002']![0]!.status).toBe('read')
    expect(state.messagesByChat['10000002']).toHaveLength(1)
    expect(state.byId).toEqual({})
    expect(state.seenMessageIds).toEqual({})
  })

  it('не создаёт сообщений для неизвестного идентификатора', () => {
    const initial = stateWithMessage()
    expect(
      reducer(
        initial,
        messageStatusUpdated({
          chatId: '10000002',
          idMessage: 'missing',
          status: 'read',
        }),
      ),
    ).toBe(initial)
  })

  it('не обновляет входящее с совпадающим идентификатором', () => {
    const initial = stateWithMessage('sent', 'in')
    expect(
      reducer(
        initial,
        messageStatusUpdated({
          chatId: '10000002',
          idMessage: 'message-1',
          status: 'read',
        }),
      ),
    ).toBe(initial)
  })

  it('подтверждение отправки не откатывает прочитанное сообщение', () => {
    const state = reducer(
      stateWithMessage('read'),
      sendMessage.fulfilled(
        { chatId: '10000002', key: 'local-key', idMessage: 'message-1' },
        'local-key',
        { sessionId: 1, chatId: '10000002', text: 'Текст' },
      ),
    )
    expect(state.messagesByChat['10000002']![0]!.status).toBe('read')
  })

  it('подтверждённая доставка убирает прежнюю ошибку', () => {
    const initial = stateWithMessage('unknown')
    const state = reducer(
      {
        ...initial,
        messagesByChat: {
          '10000002': [
            { ...initial.messagesByChat['10000002']![0]!, error: 'Ошибка' },
          ],
        },
      },
      messageStatusUpdated({
        chatId: '10000002',
        idMessage: 'message-1',
        status: 'delivered',
      }),
    )
    expect(state.messagesByChat['10000002']![0]!.error).toBeUndefined()
  })
})
