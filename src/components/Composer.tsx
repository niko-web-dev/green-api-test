import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'react-redux'
import { MESSENGERS } from '../messengers/messengers'
import { useAppDispatch, useAppSelector } from '../store'
import { selectSession } from '../store/sessionSlice'
import { sendMessage } from '../store/thunks'
import type { RootState } from '../store/types'
import styles from './Composer.module.css'
import Icon from './Icon'
import type { ComposerProps } from './types'

export default function Composer({ chatId }: ComposerProps) {
  const dispatch = useAppDispatch()
  const store = useStore<RootState>()
  const { current, sessionId } = useAppSelector(selectSession)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const limit = current ? MESSENGERS[current.messenger].maxMessageLength : 0
  const allowed = !!text.trim() && text.length <= limit
  useLayoutEffect(() => {
    const element = textarea.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 144)}px`
  }, [text])
  function submit() {
    if (!allowed) return
    setError(null)
    const request = dispatch(sendMessage({ chatId, text, sessionId }))
    // Поле очищается только после сохранения текста в оптимистичном сообщении.
    const saved = store
      .getState()
      .chats.messagesByChat[chatId]?.some(
        (message) => message.key === request.requestId,
      )
    if (saved) setText('')
    else setError('Не удалось начать отправку. Текст сохранён в поле ввода.')
    textarea.current?.focus()
  }
  return (
    <div className={styles.wrapper}>
      <div aria-live="polite">
        {error && <p className="notice error">{error}</p>}
      </div>
      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label htmlFor="message-text" className="srOnly">
          Сообщение
        </label>
        <textarea
          ref={textarea}
          id="message-text"
          rows={1}
          placeholder="Напишите сообщение…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby="composer-hint"
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button
          type="submit"
          disabled={!allowed}
          aria-label="Отправить сообщение"
        >
          <Icon name="send" />
        </button>
      </form>
      <div id="composer-hint" className={styles.hint}>
        <span>Enter — отправить · Shift + Enter — новая строка</span>
        {text.length >= limit * 0.9 && (
          <span
            className={text.length > limit ? styles.overLimit : ''}
            role="status"
          >
            {text.length} / {limit}
          </span>
        )}
      </div>
    </div>
  )
}
