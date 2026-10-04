import { useEffect, useRef } from 'react'
import { Provider } from 'react-redux'
import ChatLayout from './components/ChatLayout'
import LoginScreen from './components/LoginScreen'
import { store, useAppDispatch, useAppSelector } from './store'
import { selectSession } from './store/sessionSlice'
import { restoreSession } from './store/thunks'
import './styles/variables.css'
import './styles/global.css'
import type { AppProps } from './types'

function Screens() {
  const dispatch = useAppDispatch()
  const { current } = useAppSelector(selectSession)
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    void dispatch(restoreSession())
  }, [dispatch])
  return current ? <ChatLayout /> : <LoginScreen />
}

export default function App({ store: customStore = store }: AppProps = {}) {
  return (
    <Provider store={customStore}>
      <Screens />
    </Provider>
  )
}
