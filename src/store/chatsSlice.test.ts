import { describe, expect, it } from 'vitest'
import reducer, { messageStatusUpdated, outgoingStarted } from './chatsSlice'
import type { Message } from './chatsSlice'
import type { DeliveryStatus } from '../notifications'
import { sendMessage } from './thunks'

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
      messageStatusUpdated({ idMessage: 'message-1', status: next }),
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
        messageStatusUpdated({ idMessage: 'message-1', status }),
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
        messageStatusUpdated({ idMessage: 'missing', status: 'read' }),
      ),
    ).toBe(initial)
  })

  it('не обновляет входящее с совпадающим идентификатором', () => {
    const initial = stateWithMessage('sent', 'in')
    expect(
      reducer(
        initial,
        messageStatusUpdated({ idMessage: 'message-1', status: 'read' }),
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
      messageStatusUpdated({ idMessage: 'message-1', status: 'delivered' }),
    )
    expect(state.messagesByChat['10000002']![0]!.error).toBeUndefined()
  })
})
