import { useAppSelector } from '../store'
import { selectSession } from '../store/sessionSlice'
import { selectActiveChat } from '../store/chatsSlice'
import ChatList from './ChatList'
import ChatWindow from './ChatWindow'
import styles from './ChatLayout.module.css'

export default function ChatLayout() {
  const session = useAppSelector(selectSession)
  const chat = useAppSelector(selectActiveChat)
  return (
    <main className={styles.layout}>
      <div className={`${styles.sidebar} ${chat ? styles.hiddenMobile : ''}`}>
        <ChatList />
      </div>
      <section
        className={`${styles.main} ${!chat ? styles.hiddenMobile : ''}`}
        aria-label="Переписка"
      >
        <div aria-live="polite">
          {session.warning && <p className="notice">{session.warning}</p>}
          {session.connection === 'error' && (
            <p className="notice error">
              {session.error ??
                'Получение сообщений остановлено. Выйдите и подключитесь снова.'}
            </p>
          )}
        </div>
        <ChatWindow />
      </section>
    </main>
  )
}
