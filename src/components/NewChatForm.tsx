import { useState } from 'react'
import type { FormEvent } from 'react'
import { normalizePhone, PHONE_HINT, validatePhone } from '../messengers'
import { useAppDispatch, useAppSelector } from '../store'
import { selectSessionId } from '../store/sessionSlice'
import { openChat } from '../store/thunks'
import Icon from './Icon'
import styles from './ChatList.module.css'

export default function NewChatForm() {
  const dispatch = useAppDispatch()
  const sessionId = useAppSelector(selectSessionId)
  const { openRequestId, error } = useAppSelector((state) => state.chats)
  const [phone, setPhone] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (openRequestId) return
    const problem = validatePhone(normalizePhone(phone))
    setInvalid(problem)
    if (problem) return
    const result = await dispatch(openChat({ sessionId, phoneInput: phone }))
    if (openChat.fulfilled.match(result)) setPhone('')
  }
  return (
    <form className={styles.newChat} onSubmit={(e) => void submit(e)}>
      <label htmlFor="new-phone">Новый чат</label>
      <div className={styles.phoneRow}>
        <input
          id="new-phone"
          type="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value)
            setInvalid(null)
          }}
          placeholder="+7 · Номер телефона"
          aria-describedby="phone-hint phone-error"
          disabled={!!openRequestId}
        />
        <button
          type="submit"
          aria-label={openRequestId ? 'Проверяем номер' : 'Открыть чат'}
          disabled={!!openRequestId}
        >
          <Icon name="plus" />
        </button>
      </div>
      <small id="phone-hint">{PHONE_HINT}</small>
      <div id="phone-error" aria-live="polite">
        {(invalid || error) && (
          <p className="notice error">{invalid || error}</p>
        )}
      </div>
    </form>
  )
}
