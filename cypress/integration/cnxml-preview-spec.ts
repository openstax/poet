// Shares a namespace with the other specfiles if not scoped
import { PanelIncomingMessage, PanelOutgoingMessage, ScrollInEditorIncoming } from '../../client/src/panel-cnxml-preview'
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
    function sendScrollToLine(line: number): void {
      sendMessage({ type: 'scroll-in-preview', line })
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
        expect(messagesFromWidget[0]).to.deep.equal({ type: 'direct-edit', xml: '<howdy/>' })
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

    describe('Scroll handling', () => {
      beforeEach(() => {
        const nLines = (n: number) => `<pre>${'\n'.repeat(n)}</pre>`
        sendXml(`
          <document data-line="1">
          ${nLines(100)}
          <para data-line="2">Line 2</para>
          ${nLines(100)}
          <para data-line="3">Line 3</para>
          ${nLines(100)}
          <para data-line="4">Line 4</para>
          ${nLines(100)}
          <para data-line="5">Line 5</para>
          ${nLines(100)}
          </document>`
        )
      })
      it('scrolls to an element based on its line in the source', () => {
        cy.awaitInternalEvent('scroll', () => {
          sendScrollToLine(2)
        })
        cy.get('[data-line="2"]').then(el => {
          cy.window().its('scrollY').should('equal', el.get(0).offsetTop)
        })
        cy.then(() => {
          expect(messagesFromWidget.length).to.equal(1)
          expect(messagesFromWidget[0].type).to.equal('scroll-in-editor')
          expect((messagesFromWidget[0] as ScrollInEditorIncoming).line).to.be.closeTo(2, 0.01)
        })
      })
      it('scrolls to an element based on its line in the source', () => {
        cy.awaitInternalEvent('scroll', () => {
          sendScrollToLine(2.5)
        })
        cy.get('[data-line]').then(el => {
          const halfDistanceBetween = Math.floor((el.get(2).offsetTop - el.get(1).offsetTop) / 2)
          cy.window().its('scrollY').should('equal', el.get(1).offsetTop + halfDistanceBetween)
        })
        cy.then(() => {
          expect(messagesFromWidget.length).to.equal(1)
          expect(messagesFromWidget[0].type).to.equal('scroll-in-editor')
          expect((messagesFromWidget[0] as ScrollInEditorIncoming).line).to.be.closeTo(2.5, 0.01)
        })
      })
      it('scrolls to an element based on its line in the source', () => {
        cy.awaitInternalEvent('scroll', () => {
          sendScrollToLine(4)
        })
        cy.get('[data-line="4"]').then(el => {
          cy.window().its('scrollY').should('equal', el.get(0).offsetTop)
        })
        cy.then(() => {
          expect(messagesFromWidget.length).to.equal(1)
          expect(messagesFromWidget[0].type).to.equal('scroll-in-editor')
          expect((messagesFromWidget[0] as ScrollInEditorIncoming).line).to.be.closeTo(4, 0.01)
        })
      })
      it('provides a scroll location to the editor upon scroll', () => {
        cy.awaitInternalEvent('scroll', () => {
          cy.get('[data-line="2"').scrollIntoView()
        }).then(() => {
          expect(messagesFromWidget.length).to.equal(1)
          expect(messagesFromWidget[0].type).to.equal('scroll-in-editor')
          expect((messagesFromWidget[0] as ScrollInEditorIncoming).line).to.be.closeTo(2, 0.01)
        })
      })
      it('provides a scroll location to the editor upon scroll', () => {
        cy.awaitInternalEvent('scroll', () => {
          cy.get('[data-line]').then(el => {
            const halfDistanceBetween = Math.floor((el.get(2).offsetTop - el.get(1).offsetTop) / 2)
            cy.window().then(win => {
              win.scrollTo(win.scrollX, el.get(1).offsetTop + halfDistanceBetween)
            })
          })
        }).then(() => {
          expect(messagesFromWidget.length).to.equal(1)
          expect(messagesFromWidget[0].type).to.equal('scroll-in-editor')
          expect((messagesFromWidget[0] as ScrollInEditorIncoming).line).to.be.closeTo(2.5, 0.01)
        })
      })
      it('provides a scroll location to the editor upon scroll', () => {
        cy.awaitInternalEvent('scroll', () => {
          cy.get('[data-line="4"').scrollIntoView()
        }).then(() => {
          expect(messagesFromWidget.length).to.equal(1)
          expect(messagesFromWidget[0].type).to.equal('scroll-in-editor')
          expect((messagesFromWidget[0] as ScrollInEditorIncoming).line).to.be.closeTo(4, 0.01)
        })
      })
      it('sends no scroll event on xml without line tagging', () => {
        sendXml('<document />')
        cy.awaitInternalEvent('scroll', () => {
          cy.window().trigger('scroll')
        }).then(() => {
          expect(messagesFromWidget).to.be.empty
        })
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
