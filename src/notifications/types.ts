export interface IncomingText {
  chatId: string
  idMessage: string
  text: string
  timestamp: number
  chatName: string
  typeInstance: string
}

export type DeliveryStatus = 'sent' | 'delivered' | 'read'

export interface OutgoingMessageStatus {
  chatId: string
  idMessage: string
  status: DeliveryStatus
  timestamp: number
  typeInstance: string
}
