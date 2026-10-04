import { useLayoutEffect, useRef } from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import { selectSession } from '../store/sessionSlice'
import { MESSENGERS } from '../messengers/messengers'
import {
  chatSelected,
  selectActiveChat,
  selectActiveMessages,
} from '../store/chatsSlice'
import Composer from './Composer'
import MessageBubble from './MessageBubble'
import Icon from './Icon'
import ConnectionStatus from './ConnectionStatus'
import { maskInstance } from './formatInstance'
import styles from './ChatWindow.module.css'

export default function ChatWindow() {
  const dispatch = useAppDispatch()
  const chat = useAppSelector(selectActiveChat)
  const messages = useAppSelector(selectActiveMessages)
  const { current } = useAppSelector(selectSession)
  const feed = useRef<HTMLUListElement>(null)
  const atBottom = useRef(true)
  const previousChat = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    const element = feed.current
    if (!element) return
    if (previousChat.current !== chat?.chatId || atBottom.current) {
      element.scrollTop = element.scrollHeight
      atBottom.current = true
    }
    previousChat.current = chat?.chatId
  }, [chat?.chatId, messages])
  if (!chat)
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>
          <Icon name="chat" size={42} />
        </span>
        <h2>Начните с «Привет»</h2>
        <p>Выберите чат или начните новый</p>
        <small>Личные разговоры, без лишних деталей.</small>
      </div>
    )
  return (
    <div className={styles.window}>
      <header className={styles.header}>
        <button
          className={`${styles.back} iconButton`}
          aria-label="Назад к списку чатов"
          onClick={() => dispatch(chatSelected(null))}
        >
          <Icon name="back" />
        </button>
        <span className={styles.avatar}>
          {chat.title.replace(/^\+/, '').slice(0, 2).toUpperCase()}
        </span>
        <div className={styles.chatInfo}>
          <h2>{chat.title}</h2>
          <p>{chat.phone ? `+${chat.phone}` : `ID: ${chat.chatId}`}</p>
        </div>
        <span className={styles.headerNote}>Текстовый чат</span>
      </header>
      {current && (
        <div
          className={styles.mobileAccount}
          role="group"
          aria-label="Текущее подключение"
        >
          <span>
            {MESSENGERS[current.messenger].title} · Инстанс{' '}
            {maskInstance(current.credentials.idInstance)}
          </span>
          <ConnectionStatus className={styles.mobileConnection} />
        </div>
      )}
      <ul
        ref={feed}
        className={styles.feed}
        aria-label="Сообщения"
        onScroll={() => {
          const element = feed.current
          if (element)
            atBottom.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              64
        }}
      >
        {messages.length === 0 && (
          <li className={styles.start}>
            Разговор начинается здесь.
            <br />
            Отправьте первое сообщение.
          </li>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.key} message={message} />
        ))}
      </ul>
      <Composer key={chat.chatId} chatId={chat.chatId} />
    </div>
  )
}
