export interface Credentials {
  apiUrl: string
  idInstance: string
  apiTokenInstance: string
}

export interface ReceivedNotification {
  receiptId: number
  body: Record<string, unknown>
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
