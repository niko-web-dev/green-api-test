export interface Credentials {
  apiUrl: string
  idInstance: string
  apiTokenInstance: string
}

export interface NotificationBody {
  typeWebhook: string
  instanceData?: {
    idInstance?: number
    wid?: string
    typeInstance?: string
    [key: string]: unknown
  }
  timestamp?: number
  idMessage?: string
  senderData?: Record<string, unknown>
  messageData?: Record<string, unknown>
  status?: string
  [key: string]: unknown
}

export interface ReceivedNotification {
  receiptId: number
  body: NotificationBody
}

export interface StateInstanceResponse {
  stateInstance: string
}

export interface CheckAccountResponse {
  exist: boolean
  chatId: string
}

export interface CheckWhatsappResponse {
  existsWhatsapp: boolean
}

export interface SendMessageResponse {
  idMessage: string
}

export interface DeleteNotificationResponse {
  result: boolean
}
