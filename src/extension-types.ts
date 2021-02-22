export enum PanelType {
  TOC_EDITOR = 'openstax.tocEditor',
  IMAGE_UPLOAD = 'openstax.imageUpload',
  CNXML_PREVIEW = 'openstax.cnxmlPreview'
}
export enum OpenstaxCommand {
  SHOW_TOC_EDITOR = 'openstax.showTocEditor',
  SHOW_CNXML_PREVIEW = 'openstax.showPreviewToSide',
  SHOW_IMAGE_UPLOAD = 'openstax.showImageUpload'
}

export const commandToPanelType: {[key in OpenstaxCommand]: PanelType} = {
  [OpenstaxCommand.SHOW_TOC_EDITOR]: PanelType.TOC_EDITOR,
  [OpenstaxCommand.SHOW_IMAGE_UPLOAD]: PanelType.IMAGE_UPLOAD,
  [OpenstaxCommand.SHOW_CNXML_PREVIEW]: PanelType.CNXML_PREVIEW
}
