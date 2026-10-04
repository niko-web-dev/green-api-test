import type { Message } from '../store/types'

export interface IconProps {
  name: 'chat' | 'send' | 'back' | 'logout' | 'plus'
  size?: number
}

export interface ComposerProps {
  chatId: string
}
export interface MessageBubbleProps {
  message: Message
}
