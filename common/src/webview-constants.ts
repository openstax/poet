/* istanbul ignore file */
export enum PanelStateMessageType {
  Request = 'PanelStateMessageType.Request',
  Response = 'PanelStateMessageType.Response'
}

export interface PanelStateMessage<S> {
  type: PanelStateMessageType.Response
  state: S
}
