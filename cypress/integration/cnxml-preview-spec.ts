// Shares a namespace with the other specfiles if not scoped
import { PanelIncomingMessage, PanelOutgoingMessage } from '../../client/src/panel-cnxml-preview'
{
  // The HTML file that cypress should load when running tests (relative to the project root)
  const htmlPath = './client/out/client/src/cnxml-preview.html'

  describe('cnxml-preview Webview Tests', () => {
    function sendMessage(msg: PanelOutgoingMessage): void {
      cy.window().then($window => {
        $window.postMessage(msg, '*')
      })
    }
    function sendXml(xmlStr: string): void {
      sendMessage({ type: 'refresh', xml: xmlStr })
    }

    // When the browser calls vscode.postMessage(...) that message is added to this array
    let messagesFromWidget: PanelIncomingMessage[] = []

    beforeEach(() => {
      // Load the HTML file and inject the acquireVsCodeApi() stub.
      cy.visit(htmlPath, {
        onBeforeLoad: (contentWindow): void => {
          class API {
            postMessage(msg: PanelIncomingMessage): void { messagesFromWidget.push(msg) }
          }
          (contentWindow as any).acquireVsCodeApi = () => { return new API() }
        }
      })
    })
    afterEach(() => {
      // Clear shared vars
      messagesFromWidget = []
    })

    it('Errors when malformed outgoing message is sent', () => {
      sendMessage(({ type: 'xml', somethingOtherThanXml: 'hello' } as unknown as PanelOutgoingMessage))
      cy.get('#preview *').should('not.exist')
    })

    it('Errors when malformed XML is sent', () => {
      sendXml('<invalid-xml-element-name')
      cy.get('#preview parsererror').should('exist')
    })

    it('Does not error when valid XML is sent', () => {
      sendXml('<valid-xml-element/>')
      cy.get('#preview parsererror').should('not.exist')
    })

    it('Updates the DOM when new content is sent', () => {
      sendXml('<document><para>I am a paragraph</para></document>')
      cy.get('#preview p').should('exist')
      cy.get('#preview ul').should('not.exist')
      sendXml('<document><list><item>I am a list with one item</item></list></document>')
      cy.get('#preview p').should('not.exist')
      cy.get('#preview ul').should('exist')
    })

    it('Sends XML back when clicked (remove this. it should send a command instead of the whole CNXML)', () => {
      sendXml('<howdy/>')
      cy.get('#advancedDetails').click() // expand
      cy.get('#sendButton').click().then(() => {
        expect(messagesFromWidget.length).equal(1)
        expect(messagesFromWidget[0].xml).equal('<howdy/>')
      })
    })

    describe('cnxml->html conversion', () => {
      it('Translates CNXML tags to HTML', () => {
        sendXml('<para>I am a paragraph</para>')
        cy.get('#preview para').should('not.exist')
        cy.get('#preview p').should('exist')
      })

      it('Ignores comments', () => {
        sendXml('<document><!-- I am a comment --></document>')
        cy.get('#preview document').should('exist')
      })

      it('Removes some elements like metadata', () => {
        sendXml('<document><metadata><para>Para in a metadata</para></metadata></document>')
        cy.get('#preview p').should('not.exist')
      })
    })

    describe('Handling math', () => {
      it('Strips the m: prefix from math elements', () => {
        sendXml('<document><m:math xmlns:m="https://openstax.org/anything"><m:mtext>I am a math element</m:mtext></m:math></document>')
        cy.get('#preview math').should('exist')
      })

      it('Updates Math nodes in the DOM when new content is sent', () => {
        // MathJax requires some hacky work
        sendXml('<document><math><mi>x</mi></math></document>')
        cy.get('#preview mi').should('exist')
        cy.get('#preview mn').should('not.exist')
        sendXml('<document><math><mn>2</mn></math></document>')
        cy.get('#preview mi').should('not.exist')
        cy.get('#preview mn').should('exist')
      })
    })

    describe('VirtualDOM (vdom)', () => {
      it('removes an element', () => {
        sendXml('<root><child/></root>')
        sendXml('<root/>')
      })

      it('removes an attribute', () => {
        sendXml('<root id="id123"/>')
        sendXml('<root/>')
      })
    })
  })
}
