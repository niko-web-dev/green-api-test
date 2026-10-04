import { MESSENGERS } from '../messengers/messengers'
import { useAppDispatch, useAppSelector } from '../store'
import { chatSelected, selectChatList } from '../store/chatsSlice'
import { loggedOut, selectSession } from '../store/sessionSlice'
import styles from './ChatList.module.css'
import Icon from './Icon'
import NewChatForm from './NewChatForm'
import { formatTime } from './formatTime'
import { maskInstance } from './formatInstance'
import ConnectionStatus from './ConnectionStatus'

export default function ChatList() {
  const dispatch = useAppDispatch()
  const session = useAppSelector(selectSession)
  const chats = useAppSelector(selectChatList)
  const active = useAppSelector((state) => state.chats.activeChatId)
  const messages = useAppSelector((state) => state.chats.messagesByChat)
  if (!session.current) return null
  const id = session.current.credentials.idInstance
  const masked = maskInstance(id)
  return (
    <aside className={styles.sidebar} aria-label="Список чатов">
      <header className={styles.header}>
        <span className={styles.logo}>
          <Icon name="chat" />
        </span>
        <div className={styles.account}>
          <h1>{MESSENGERS[session.current.messenger].title}</h1>
          <span>Инстанс {masked}</span>
        </div>
        <button
          className="iconButton"
          aria-label="Выйти"
          onClick={() => dispatch(loggedOut())}
        >
          <Icon name="logout" />
        </button>
      </header>
      <ConnectionStatus className={styles.connection} />
      <div aria-live="polite" className={styles.mobileNotice}>
        {session.warning && <p className="notice">{session.warning}</p>}
        {session.connection === 'error' && (
          <p className="notice error">
            {session.error ?? 'Выйдите и подключитесь снова.'}
          </p>
        )}
      </div>
      <NewChatForm />
      <div className={styles.listHeading}>
        Сообщения <span>{chats.length}</span>
      </div>
      <ul className={styles.list}>
        {chats.map((chat) => {
          const last = messages[chat.chatId]?.at(-1)
          return (
            <li key={chat.chatId}>
              <button
                className={`${styles.chat} ${active === chat.chatId ? styles.active : ''}`}
                aria-current={active === chat.chatId ? 'true' : undefined}
                onClick={() => dispatch(chatSelected(chat.chatId))}
              >
                <span className={styles.avatar}>
                  {chat.title.replace(/^\+/, '').slice(0, 2).toUpperCase()}
                </span>
                <span className={styles.chatText}>
                  <span className={styles.chatTitle}>{chat.title}</span>
                  <span className={styles.preview}>
                    {last
                      ? `${last.direction === 'out' ? 'Вы: ' : ''}${last.text}`
                      : 'Начните разговор'}
                  </span>
                </span>
                <time
                  className={styles.time}
                  dateTime={new Date(chat.lastActivity * 1000).toISOString()}
                >
                  {formatTime(chat.lastActivity)}
                </time>
              </button>
            </li>
          )
        })}
      </ul>
      {!chats.length && (
        <p className={styles.empty}>
          Здесь будут ваши диалоги.
          <br />
          Начните новый чат по номеру телефона.
        </p>
      )}
    </aside>
  )
}
