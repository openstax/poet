/// <reference types="cypress" />

describe('cnxml-preview Webview Tests', () => {
  function postMessage(msg) {
    cy.window().then($window => {
      $window.postMessage(msg, '*')
    })
  }
  function postXml(xmlStr) {
    postMessage({xml: xmlStr})
  }

  let pending = []

  beforeEach(() => {
    cy.visit('./out-instrumented/cnxml-preview.html', {
      onBeforeLoad: (contentWindow) => {
        class API {
          postMessage(msg) { pending.push(msg) }
        }
        contentWindow.acquireVsCodeApi = () => { return new API() }
      }
    })
  })

  it('Errors when something other than an object with an xml field is sent', () => {
    postMessage({somethingOtherThanXml: 'hello'})
    cy.get('#preview *').should('not.exist')
  })

  it('Errors when malformed XML is sent', () => {
    postXml('<invalid-xml-element-name')
    cy.get('#preview parsererror').should('exist')
  })

  it('Does not error when valid XML is ssent', () => {
    postXml('<valid-xml-element/>')
    cy.get('#preview parsererror').should('not.exist')
  })

  it('Updates the DOM when new content is sent', () => {
    postXml('<document><para>I am a paragraph</para></document>')
    cy.get('#preview p').should('exist')
    cy.get('#preview ul').should('not.exist')
    postXml('<document><list><item>I am a list with one item</item></list></document>')
    cy.get('#preview p').should('not.exist')
    cy.get('#preview ul').should('exist')
  })

  it('Sends XML back when clicked (remove this. it should send a command instead of the whole CNXML)', () => {
    postXml('<howdy/>')
    cy.get('#advancedDetails').click() // expand
    cy.get('#sendButton').click().then(() => {
      expect(pending.length).equal(1)
      expect(pending[0].xml).equal('<howdy/>')
    })
  })

  describe('cnxml->html conversion', () => {
    it('Translates CNXML tags to HTML', () => {
      postXml('<para>I am a paragraph</para>')
      cy.get('#preview para').should('not.exist')
      cy.get('#preview p').should('exist')
    })
    
    it('Ignores comments', () => {
      postXml('<document><!-- I am a comment --></document>')
      cy.get('#preview document').should('exist')
    })
  
    it('Removes some elements like metadata', () => {
      postXml('<document><metadata><para>Para in a metadata</para></metadata></document>')
      cy.get('#preview p').should('not.exist')
    })
  })

  describe('Handling math', () => {
    it('Strips the m: prefix from math elements', () => {
      postXml('<document><m:math xmlns:m="https://openstax.org/anything"><m:mtext>I am a math element</m:mtext></m:math></document>')
      cy.get('#preview math').should('exist')
    })
  
    it('Updates Math nodes in the DOM when new content is sent', () => {
      // MathJax requires some hacky work
      postXml('<document><math><mi>x</mi></math></document>')
      cy.get('#preview mi').should('exist')
      cy.get('#preview mn').should('not.exist')
      postXml('<document><math><mn>2</mn></math></document>')
      cy.get('#preview mi').should('not.exist')
      cy.get('#preview mn').should('exist')
    })
  })

  describe('VirtualDOM (vdom)', () => {
    it('removes an element', () => {
      postXml('<root><child/></root>')
      postXml('<root/>')
    })

    it('removes an attribute', () => {
      postXml('<root id="id123"/>')
      postXml('<root/>')
    })
  })

})