// Shares a namespace with the other specfiles if not scoped
import { PanelIncomingMessage, PanelOutgoingMessage } from '../../client/src/panel-toc-editor'
{
  // The HTML file that cypress should load when running tests (relative to the project root)
  const htmlPath = './client/out/client/src/toc-editor.html'

  const DO_NOT_INCREMENT = -1

  enum TocNodeKind {
    Inner = 'TocNodeKind.Inner',
    Leaf = 'TocNodeKind.Leaf'
  }

  type TocNode = {
    title?: string
    expanded?: true
    children: TocNode[]
  } | TocNode[] | string
  let counter = 0
  const recBuildSubtree = (node: TocNode) => {
    if (typeof node === 'string') {
      if (counter === DO_NOT_INCREMENT) {
        --counter
      }
      const id = `m0000${++counter}`
      return {
        type: TocNodeKind.Leaf,
        token: `page-token-${id}`,
        moduleid: id,
        subtitle: id,
        title: node
      }
    } else if (Array.isArray(node)) {
      return {
        type: TocNodeKind.Inner,
        title: 'subcollection',
        token: 'subbook-token',
        children: node.map(recBuildSubtree)
      }
    } else {
      const title = node.title ?? 'subcollection'
      return {
        type: TocNodeKind.Inner,
        title,
        token: `subbook-token-${title}`,
        expanded: node.expanded ?? false,
        children: node.children.map(recBuildSubtree)
      }
    }
  }
  interface BuildBookOptions {
    title?: string
    slug?: string
    startAt?: number
  }
  const buildBook = (tree: TocNode[], opts: BuildBookOptions = {}) => {
    const title = opts.title ?? 'test collection'
    const slug = opts.slug ?? 'test'
    const startAt = opts.startAt
    if (startAt !== undefined) {
      counter = startAt
    }
    return {
      type: 'collection',
      title,
      slug,
      tree: tree.map(recBuildSubtree)
    }
  }

  describe('toc-editor Webview Tests', () => {
    function sendMessage(msg: PanelOutgoingMessage): void {
      cy.log('sending message', msg)
      cy.window().then($window => {
        $window.postMessage(msg, '*')
      })
    }

    // When the browser calls vscode.postMessage(...) that message is added to this array
    let messagesFromWidget: PanelIncomingMessage[] = []
    // When the browser calls vscode.setState, that state is stored here
    let pageState: any

    beforeEach(() => {
      counter = 0
      // Load the HTML file and inject the acquireVsCodeApi() stub.
      cy.visit(htmlPath, {
        onBeforeLoad: (contentWindow) => {
          class API {
            postMessage(msg: PanelIncomingMessage): void { messagesFromWidget.push(msg) }
            getState(): any { return pageState }
            setState(state: any): void { pageState = state }
          }
          (contentWindow as any).acquireVsCodeApi = () => { return new API() }
        }
      })
    })

    afterEach(() => {
      // Clear shared vars
      messagesFromWidget = []
      pageState = undefined
    })
    it('will not load until a message is sent (unreliable state store)', () => {
      cy.get('[data-app-init]').should('not.exist')
    })
    it('will load when a message is sent (empty)', () => {
      sendMessage({
        editable: [],
        uneditable: []
      })
      cy.get('[data-app-init]').should('exist')
      cy.get('.panel-editable .rst__node').should('not.exist')
      cy.get('.panel-uneditable .rst__node').should('not.exist')
    })
    it('will load when a message is sent', () => {
      const book = buildBook([['Introduction'], 'Appendix'])
      sendMessage({ editable: [book], uneditable: [] })
      cy.get('[data-app-init]').should('exist')
      cy.get('.panel-editable .rst__node').should('have.length', 2)
      cy.get('.panel-uneditable .rst__node').should('not.exist')
    })
    it('will load when a message is sent (expanded)', () => {
      const book = buildBook([{ expanded: true, children: ['Introduction'] }, 'Appendix'])
      sendMessage({ editable: [book], uneditable: [] })
      cy.get('[data-app-init]').should('exist')
      cy.get('.panel-editable .rst__node').should('have.length', 3)
      cy.get('.panel-uneditable .rst__node').should('not.exist')
    })
    it('will not re-render on same data (expanded)', () => {
      const book1 = buildBook([['Introduction']])
      const message: PanelOutgoingMessage = {
        editable: [book1],
        uneditable: []
      }
      sendMessage(message)
      cy.get('[data-render-cached]').should('not.exist')
      sendMessage(message)
      cy.get('[data-render-cached]').should('exist')

      const book2 = buildBook([['Introduction'], 'Appendix'])
      sendMessage({ editable: [book2], uneditable: [] })
      cy.get('[data-render-cached]').should('not.exist')
    })
    it('will not re-render on same data (expanded)', () => {
      const book1 = buildBook([{ expanded: true, children: ['Introduction'] }])
      const message: PanelOutgoingMessage = {
        editable: [book1],
        uneditable: []
      }
      sendMessage(message)
      cy.get('[data-render-cached]').should('not.exist')
      sendMessage(message)
      cy.get('[data-render-cached]').should('exist')

      const book2 = buildBook([{ expanded: true, children: ['Introduction'] }, 'Appendix'])
      sendMessage({ editable: [book2], uneditable: [] })
      cy.get('[data-render-cached]').should('not.exist')
    })
    it('will preserve expanded nodes on reload', () => {
      const book1 = buildBook([{ expanded: true, children: ['Introduction'] }, ['Introduction']], { startAt: DO_NOT_INCREMENT })
      sendMessage({ editable: [book1], uneditable: [] })
      cy.get('.panel-editable .rst__node').should('have.length', 3)

      const book2 = buildBook([{ expanded: true, children: ['Introduction'] }, ['Introduction'], ['Introduction']], { startAt: DO_NOT_INCREMENT })
      sendMessage({ editable: [book2], uneditable: [] })

      // Would be 3 if the expanded subcollection was not preserved
      // Would be 4 if new nodes were initially collapsed
      cy.get('.panel-editable .rst__node').should('have.length', 6)
    })

    describe('drag-n-drop', () => {
      beforeEach(() => {
        const book = buildBook([{ expanded: true, children: ['Introduction'] }, 'Appendix'])
        const orphans = buildBook(['Module 3', 'Module 4'])
        sendMessage({
          editable: [book],
          uneditable: [orphans]
        })
      })
      it('allows dnd from uneditable to editable', () => {
        cy.get('.panel-uneditable .rst__node:nth-child(1) .rst__moveHandle')
          .dnd('.panel-editable .rst__node:nth-child(2) .rst__nodeContent')
        cy.get('.panel-editable .rst__node').should('have.length', 4)
        cy.get('.panel-uneditable .rst__node').should('have.length', 2)
        cy.wrap(messagesFromWidget).snapshot()
      })
      it('allows dnd from editable to editable', () => {
        // Drag "Appendix" on top of "Introduction"
        cy.get('.panel-editable .rst__node:nth-child(3) .rst__moveHandle')
          .dnd('.panel-editable .rst__node:nth-child(2) .rst__nodeContent', { offsetX: 100 })
        cy.get('.panel-editable .rst__node').should('have.length', 3)
        cy.get('.panel-uneditable .rst__node').should('have.length', 2)
        cy.wrap(messagesFromWidget).snapshot()
      })
      it('deletes elements when dnd from editable to uneditable', () => {
        // Drag "Appendix" to the orphans list
        cy.get('.panel-editable .rst__node:nth-child(3) .rst__moveHandle')
          .dnd('.panel-uneditable .rst__node:nth-child(1) .rst__nodeContent')
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(1)
          expect(messagesFromWidget[0].type).to.equal('TOC_REMOVE')
        })
        cy.wrap(messagesFromWidget).snapshot()
      })
      it('disallows modules from having children', () => {
        cy.get('.panel-uneditable .rst__node:nth-child(1) .rst__moveHandle')
          .dnd('.panel-editable .rst__node:nth-child(3) .rst__nodeContent', { offsetX: 100 })
        cy.get('.panel-editable .rst__node').should('have.length', 3)
        cy.get('.panel-uneditable .rst__node').should('have.length', 2)
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(0)
        })
      })
    })

    describe('controls', () => {
      beforeEach(() => {
        const book1 = buildBook([{ expanded: true, children: ['Introduction', 'Appending To Lists'] }, 'Appendix'])
        const book2 = buildBook([{ expanded: true, children: ['Introduction', 'Deleting From Lists'] }, 'Appendix'], { title: 'test collection 2', slug: 'test-2' })
        const orphans = buildBook(['Module 3', 'Module 4'])
        sendMessage({ editable: [book1, book2], uneditable: [orphans] })
      })
      it('highlights elements that match search by title', () => {
        cy.get('.panel-editable .search')
          .type('append')
        cy.get('.panel-editable .rst__rowSearchMatch').should('have.length', 2)
        cy.get('.panel-editable .search-info').should('contain.text', '1 / 2')
      })
      it('highlights elements that match search by subtitle', () => {
        cy.get('.panel-editable .search')
          .type('m00001')
        cy.get('.panel-editable .rst__rowSearchMatch').should('have.length', 1)
        cy.get('.panel-editable .search-info').should('contain.text', '1 / 1')
      })
      it('focuses different elements when navigating search', () => {
        cy.get('.panel-editable .search')
          .type('append')
        cy.get('.panel-editable .search-info').should('contain.text', '1 / 2')
        cy.get('.panel-editable .rst__rowSearchFocus').should('contain.text', 'Appending')
        cy.get('.panel-editable .search-next').click()
        cy.get('.panel-editable .search-info').should('contain.text', '2 / 2')
        cy.get('.panel-editable .rst__rowSearchFocus').should('contain.text', 'Appendix')
        cy.get('.panel-editable .search-prev').click()
        cy.get('.panel-editable .search-info').should('contain.text', '1 / 2')
        cy.get('.panel-editable .rst__rowSearchFocus').should('contain.text', 'Appending')
      })
      it('does nothing when navigating an empty search', () => {
        cy.get('.panel-editable .search')
          .type('no_match')
        cy.get('.panel-editable .search-info').should('contain.text', '0 / 0')
        cy.get('.panel-editable .rst__rowSearchFocus').should('not.exist')
        cy.get('.panel-editable .search-next').should('be.disabled')
        cy.get('.panel-editable .search-next').click({ force: true })
        cy.get('.panel-editable .search-info').should('contain.text', '0 / 0')
        cy.get('.panel-editable .rst__rowSearchFocus').should('not.exist')
        cy.get('.panel-editable .search-prev').should('be.disabled')
        cy.get('.panel-editable .search-prev').click({ force: true })
        cy.get('.panel-editable .search-info').should('contain.text', '0 / 0')
        cy.get('.panel-editable .rst__rowSearchFocus').should('not.exist')
      })
      it('switches between trees', () => {
        cy.get('.panel-editable .search')
          .type('deleting')
        cy.get('.panel-editable .search-info').should('contain.text', '0 / 0')
        cy.get('.panel-editable .tree-select')
          .select('test collection 2')
        cy.get('.panel-editable .search-info').should('contain.text', '1 / 1')
      })
      it('can tell the extension to create Page', () => {
        cy.get('.panel-editable .PAGE_CREATE')
          .click()
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(1)
          expect(messagesFromWidget[0].type).to.equal('PAGE_CREATE')
        })
        cy.wrap(messagesFromWidget).snapshot()
      })
      it('can tell the extension to create Subbook', () => {
        cy.get('.panel-editable .subcollection-create')
          .click()
        cy.get('.panel-editable .tree-select')
          .select('test collection 2')
        cy.get('.panel-editable .subcollection-create')
          .click()
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(2)
          expect(messagesFromWidget[0].type).to.equal('SUBBOOK_CREATE')
          expect(messagesFromWidget[1].type).to.equal('SUBBOOK_CREATE')
        })
        cy.wrap(messagesFromWidget).snapshot()
      })
      it('provides an input box when title is clicked, removes when blurred', () => {
        cy.get('.panel-editable .node-title')
          .eq(1)
          .click()
          .should('not.exist')
        cy.get('.panel-editable .node-title-rename')
          .eq(0)
          .blur()
          .should('not.exist')
      })
      it('provides an input box when title is clicked, removes on Enter', () => {
        cy.get('.panel-editable .node-title')
          .eq(1)
          .click()
          .should('not.exist')
        cy.get('.panel-editable .node-title-rename')
          .eq(0)
          .type('{enter}')
          .should('not.exist')
      })
      it('can tell the extension to rename Page', () => {
        cy.get('.panel-editable .node-title')
          .eq(1)
          .click()
          .should('not.exist')
        cy.get('.panel-editable .node-title-rename')
          .eq(0)
          .type('abc', { delay: 50 })
          .blur()
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(1)
          expect(messagesFromWidget[0].type).to.equal('PAGE_RENAME')
        })
        cy.wrap(messagesFromWidget).snapshot()
      })
      it('can tell the extension to rename Subbook', () => {
        cy.get('.panel-editable .node-title')
          .eq(0)
          .click()
          .should('not.exist')
        cy.get('.panel-editable .node-title-rename')
          .eq(0)
          .type('abc', { delay: 50 })
          .blur()
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(1)
          expect(messagesFromWidget[0].type).to.equal('SUBBOOK_RENAME')
        })
        cy.wrap(messagesFromWidget).snapshot()
      })
    })
  })
}
