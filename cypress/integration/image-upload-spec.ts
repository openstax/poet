// Shares a namespace with the other specfiles if not scoped
{
  // The HTML file that cypress should load when running tests (relative to the project root)
  const htmlPath = './client/out/static-resources/image-upload.html'

  interface WidgetMessage {
    mediaUploads: Array<{
      mediaName: string
      data: string
    }>
  }

  describe('image-upload Webview Tests', () => {
    // When the browser calls vscode.postMessage(...) that message is added to this array
    let messagesFromWidget: WidgetMessage[] = []

    beforeEach(() => {
      // Load the HTML file and inject the acquireVsCodeApi() stub.
      cy.visit(htmlPath, {
        onBeforeLoad: (contentWindow: any) => {
          class API {
            postMessage(msg: WidgetMessage): void { messagesFromWidget.push(msg) }
          }
          contentWindow.acquireVsCodeApi = () => { return new API() }
        }
      })
    })

    afterEach(() => {
      // Clear shared vars
      messagesFromWidget = []
    })

    it('previews dropped images', () => {
      cy.get('#drop-area')
        .dropFile('urgent.jpg')
      cy.get('#preview > div').should('have.length', 1)
    })
    it('uploads images', () => {
      cy.get('#drop-area')
        .dropFile('urgent.jpg')
      cy.get('#trigger-upload')
        .click()
      cy.then(() => {
        expect(messagesFromWidget.length).to.equal(1)
        expect(messagesFromWidget[0].mediaUploads.length).to.equal(1)
        expect(messagesFromWidget[0].mediaUploads[0].mediaName).to.equal('urgent.jpg')
        expect(messagesFromWidget[0].mediaUploads[0].data).to.contain('base64')
      })
    })
    it('cancels upload', () => {
      cy.get('#drop-area')
        .dropFile('urgent.jpg')
      cy.get('#drop-area')
        .dropFile('urgent.jpg')
      cy.get('#preview > div').should('have.length', 2)
      cy.get('#cancel-upload')
        .click()
      cy.get('#preview > div').should('not.exist')
    })
  })
}
