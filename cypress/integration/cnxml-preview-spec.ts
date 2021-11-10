// Shares a namespace with the other specfiles if not scoped
import { PanelIncomingMessage, ScrollInEditorIncoming, ScrollToLineOutgoing } from '../../client/src/panel-cnxml-preview'
import { PanelStateMessage, PanelStateMessageType } from '../../common/src/webview-constants'
{
  // The HTML file that cypress should load when running tests (relative to the project root)
  const htmlPath = './client/out/client/src/cnxml-preview.html'

  describe('cnxml-preview Webview Tests', () => {
    function sendMessage(msg: ScrollToLineOutgoing | PanelStateMessage<any>): void {
      cy.window().then($window => {
        $window.postMessage(msg, '*')
      })
    }
    function sendXml(xmlStr: string): void {
      cy.fixture('cnxml-to-html5.xsl').then(xsl => {
        sendMessage({ type: PanelStateMessageType.Response, state: { xml: xmlStr, xsl: xsl } })
      })
    }
    function createCnxmlFromContent(content: string): string {
      return `<document xmlns="http://cnx.rice.edu/cnxml"><content>${content}</content></document>`
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
      sendMessage(({ type: 'xml', somethingOtherThanXml: 'hello' } as unknown as PanelStateMessage<any>))
      cy.get('#preview *').should('not.exist')
    })

    it('Errors when malformed XML is sent', () => {
      sendXml('<invalid-xml-element-name')
      cy.get('#preview').should('include.text', 'page contains the following errors')
    })

    it('Does not error when valid XML is sent', () => {
      sendXml('<valid-xml-element/>')
      cy.get('#preview').should('not.contain', 'page contains the following errors')
    })

    it('Updates the DOM when new content is sent', () => {
      sendXml(createCnxmlFromContent('<para>I am a paragraph</para>'))
      cy.get('#preview p').should('exist')
      cy.get('#preview ul').should('not.exist')
      sendXml(createCnxmlFromContent('<list><item>I am a list with one item</item></list>'))
      cy.get('#preview p').should('not.exist')
      cy.get('#preview ul').should('exist')
    })

    describe('cnxml->html conversion', () => {
      it('Translates CNXML tags to HTML', () => {
        sendXml(createCnxmlFromContent('<para>I am a paragraph</para>'))
        cy.get('#preview para').should('not.exist')
        cy.get('#preview p').should('exist')
      })

      it('Ignores comments', () => {
        sendXml(createCnxmlFromContent('<!-- I am a comment -->'))
        cy.get('#preview').should('have.text', '')
      })

      it('Removes some elements like metadata', () => {
        sendXml('<document xmlns="http://cnx.rice.edu/cnxml"><metadata><para>Para in a metadata</para></metadata></document>')
        cy.get('#preview p').should('not.exist')
      })
    })

    describe('Scroll handling', () => {
      const nLines = (n: number): string => `<preformat>${'\n'.repeat(n)}</preformat>`
      const fiveLinesSpaced = createCnxmlFromContent(`
        <section data-line="1">
        ${nLines(100)}
        <para data-line="2">Line 2</para>
        ${nLines(100)}
        <para data-line="3">Line 3</para>
        ${nLines(100)}
        <para data-line="4">Line 4</para>
        ${nLines(100)}
        <para data-line="5">Line 5</para>
        ${nLines(100)}
        </section>`)
      const oneLongLine = createCnxmlFromContent(`
        <section data-line="1">
        ${nLines(500)}
        <para data-line="1">Still line 1</para>
        </section>`)
      const oneLongLineNotFirstLine = createCnxmlFromContent(`
        <section data-line="3">
        ${nLines(500)}
        <para data-line="3">Still line 3</para>
        </section>`)
      const emptyDoc = '<document line/>'
      it('scrolls to an element based on its line in the source', () => {
        sendXml(fiveLinesSpaced)
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
        sendXml(fiveLinesSpaced)
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
        sendXml(fiveLinesSpaced)
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
      it('scrolls to last element if line number is greater than all', () => {
        sendXml(fiveLinesSpaced)
        cy.awaitInternalEvent('scroll', () => {
          sendScrollToLine(6)
        })
        cy.get('[data-line="5"]').then(el => {
          cy.window().its('scrollY').should('equal', el.get(0).offsetTop)
        })
        cy.then(() => {
          expect(messagesFromWidget.length).to.equal(1)
          expect(messagesFromWidget[0].type).to.equal('scroll-in-editor')
          expect((messagesFromWidget[0] as ScrollInEditorIncoming).line).to.be.closeTo(5, 0.01)
        })
      })
      it('provides a scroll location to the editor upon scroll', () => {
        sendXml(fiveLinesSpaced)
        cy.awaitInternalEvent('scroll', () => {
          cy.get('[data-line="2"').scrollIntoView()
        }).then(() => {
          expect(messagesFromWidget.length).to.equal(1)
          expect(messagesFromWidget[0].type).to.equal('scroll-in-editor')
          expect((messagesFromWidget[0] as ScrollInEditorIncoming).line).to.be.closeTo(2, 0.01)
        })
      })
      it('provides a scroll location to the editor upon scroll', () => {
        sendXml(fiveLinesSpaced)
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
        sendXml(fiveLinesSpaced)
        cy.awaitInternalEvent('scroll', () => {
          cy.get('[data-line="4"').scrollIntoView()
        }).then(() => {
          expect(messagesFromWidget.length).to.equal(1)
          expect(messagesFromWidget[0].type).to.equal('scroll-in-editor')
          expect((messagesFromWidget[0] as ScrollInEditorIncoming).line).to.be.closeTo(4, 0.01)
        })
      })
      it('sends no scroll event on xml without line tagging', () => {
        sendXml(emptyDoc)
        cy.awaitInternalEvent('scroll', () => {
          cy.window().trigger('scroll')
        }).then(() => {
          expect(messagesFromWidget.length).to.equal(0)
        })
      })
      it('does not respond to scroll-in-preview on xml without line tagging', () => {
        sendXml(emptyDoc)
        sendScrollToLine(1)
        cy.window().its('scrollY').should('equal', 0)
        cy.then(() => {
          expect(messagesFromWidget.length).to.equal(0)
        })
      })
      it('only ever scrolls to a single line if everything is on one line', () => {
        sendXml(oneLongLine)
        cy.awaitInternalEvent('scroll', () => {
          sendScrollToLine(1)
        })
        cy.get('[data-line="1"]').then(el => {
          cy.window().its('scrollY').should('equal', el.get(0).offsetTop)
        })
        cy.then(() => {
          expect(messagesFromWidget.length).to.equal(1)
          expect(messagesFromWidget[0].type).to.equal('scroll-in-editor')
          expect((messagesFromWidget[0] as ScrollInEditorIncoming).line).to.be.closeTo(1, 0.01)
        })
      })
      it('only ever scrolls to a single line if everything is on one line', () => {
        sendXml(oneLongLineNotFirstLine)
        cy.awaitInternalEvent('scroll', () => {
          sendScrollToLine(1)
        })
        cy.get('[data-line="3"]').then(el => {
          cy.window().its('scrollY').should('equal', el.get(0).offsetTop)
        })
        cy.then(() => {
          expect(messagesFromWidget.length).to.equal(1)
          expect(messagesFromWidget[0].type).to.equal('scroll-in-editor')
          expect((messagesFromWidget[0] as ScrollInEditorIncoming).line).to.be.closeTo(3, 0.01)
        })
      })
      it('only ever scrolls to a single line if everything is on one line', () => {
        sendXml(oneLongLineNotFirstLine)
        cy.awaitInternalEvent('scroll', () => {
          sendScrollToLine(5)
        })
        cy.window().then(win => {
          expect(win.scrollY + win.innerHeight).to.equal(win.document.documentElement.getBoundingClientRect().height)
        })
        cy.then(() => {
          expect(messagesFromWidget.length).to.equal(1)
          expect(messagesFromWidget[0].type).to.equal('scroll-in-editor')
          expect((messagesFromWidget[0] as ScrollInEditorIncoming).line).to.be.closeTo(4, 0.1)
        })
      })
    })

    describe('Handling math', () => {
      it('Strips the m: prefix from math elements', () => {
        sendXml(createCnxmlFromContent('<m:math xmlns:m="http://www.w3.org/1998/Math/MathML"><m:mtext>I am a math element</m:mtext></m:math>'))
        cy.get('#preview math').should('exist')
      })

      it('Updates Math nodes in the DOM when new content is sent', () => {
        // MathJax requires some hacky work
        sendXml(createCnxmlFromContent('<math><mi>x</mi></math>'))
        cy.get('#preview mi').should('exist')
        cy.get('#preview mn').should('not.exist')
        sendXml(createCnxmlFromContent('<math><mn>2</mn></math>'))
        cy.get('#preview mi').should('not.exist')
        cy.get('#preview mn').should('exist')
      })
    })

    describe('VirtualDOM (vdom)', () => {
      it('adds multiple elements', () => {
        sendXml(createCnxmlFromContent('<root/>'))
        sendXml(createCnxmlFromContent('<root><child/><child/></root>'))
        cy.get('root > child').should('have.length', 2)
      })

      it('removes an element', () => {
        sendXml(createCnxmlFromContent('<root><child/></root>'))
        sendXml(createCnxmlFromContent('<root/>'))
        cy.get('root > child').should('not.exist')
      })

      it('removes an attribute', () => {
        sendXml(createCnxmlFromContent('<root id="id123"/>'))
        sendXml(createCnxmlFromContent('<root/>'))
        cy.get('root').should('not.have.attr', 'id')
      })
    })
  })
}
