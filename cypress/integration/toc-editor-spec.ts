// Shares a namespace with the other specfiles if not scoped
{
  // The HTML file that cypress should load when running tests (relative to the project root)
  const htmlPath = './client/out/toc-editor.html'

  interface TreeData {type: string, title: string, slug?: string, subtitle?: string, expanded?: true, children?: TreeData[]}
  interface SignalMessage {signal: {type: string}, treeData: TreeData}
  interface TreeMessage {editable: TreeData[], uneditable: TreeData[]}
  type WidgetMessage = SignalMessage | TreeMessage

  describe('toc-editor Webview Tests', () => {
    function sendMessage(msg: WidgetMessage): void {
      cy.window().then($window => {
        $window.postMessage(msg, '*')
      })
    }
    function sendTreeData(editable: TreeData[], uneditable: TreeData[]): void {
      sendMessage({ editable, uneditable })
    }

    // When the browser calls vscode.postMessage(...) that message is added to this array
    let messagesFromWidget: WidgetMessage[] = []
    // When the browser calls vscode.setState, that state is stored here
    let pageState: any

    beforeEach(() => {
      // Load the HTML file and inject the acquireVsCodeApi() stub.
      cy.visit(htmlPath, {
        onBeforeLoad: (contentWindow) => {
          class API {
            postMessage(msg: WidgetMessage): void { messagesFromWidget.push(msg) }
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

    it('will not load without a sent message', () => {
      cy.get('[data-app-init]').should('not.exist')
      cy.get('.panel-editable .rst__node').should('not.exist')
      cy.get('.panel-uneditable .rst__node').should('not.exist')
      cy.then(() => {
        expect(messagesFromWidget.length).equal(1)
        expect((messagesFromWidget[0] as SignalMessage).signal.type).equal('loaded')
      })
    })

    it('will load when a message is sent', () => {
      sendTreeData([{
        type: 'collection',
        title: 'test collection',
        slug: 'test',
        children: [{
          type: 'subcollection',
          title: 'subcollection',
          expanded: true,
          children: [{
            type: 'module',
            subtitle: 'm00001',
            title: 'Introduction'
          }]
        }, {
          type: 'module',
          subtitle: 'm00002',
          title: 'Appendix'
        }]
      }], [])
      cy.get('[data-app-init]').should('exist')
      cy.get('.panel-editable .rst__node').should('have.length', 3)
      cy.get('.panel-uneditable .rst__node').should('not.exist')
      cy.then(() => {
        expect(messagesFromWidget.length).equal(1)
        expect((messagesFromWidget[0] as SignalMessage).signal.type).equal('loaded')
      })
    })

    describe('drag-n-drop', () => {
      beforeEach(() => {
        sendTreeData([{
          type: 'collection',
          title: 'test collection',
          slug: 'test',
          children: [{
            type: 'subcollection',
            title: 'subcollection',
            expanded: true,
            children: [{
              type: 'module',
              subtitle: 'm00001',
              title: 'Introduction'
            }]
          }, {
            type: 'module',
            subtitle: 'm00002',
            title: 'Appendix'
          }]
        }], [{
          type: 'mock',
          title: 'mock',
          slug: 'mock',
          children: [{
            type: 'module',
            subtitle: 'm00003',
            title: 'Module 3'
          }, {
            type: 'module',
            subtitle: 'm00004',
            title: 'Module 4'
          }]
        }])
      })
      it('allows dnd from uneditable to editable', () => {
        cy.get('.panel-uneditable .rst__node:nth-child(1) .rst__moveHandle')
          .dnd('.panel-editable .rst__node:nth-child(2) .rst__nodeContent')
        cy.get('.panel-editable .rst__node').should('have.length', 4)
        cy.get('.panel-uneditable .rst__node').should('have.length', 2)
        cy.then(() => {
          expect(messagesFromWidget.length).to.equal(2)
          expect((messagesFromWidget[0] as SignalMessage).signal.type).to.equal('loaded')
          expect((messagesFromWidget[1] as SignalMessage).treeData).to.deep.equal({
            type: 'collection',
            title: 'test collection',
            slug: 'test',
            children: [{
              type: 'subcollection',
              title: 'subcollection',
              expanded: true,
              children: [{
                type: 'module',
                subtitle: 'm00003',
                title: 'Module 3'
              }, {
                type: 'module',
                subtitle: 'm00001',
                title: 'Introduction'
              }]
            }, {
              type: 'module',
              subtitle: 'm00002',
              title: 'Appendix'
            }]
          })
        })
      })
      it('allows dnd from editable to editable', () => {
        cy.get('.panel-editable .rst__node:nth-child(3) .rst__moveHandle')
          .dnd('.panel-editable .rst__node:nth-child(2) .rst__nodeContent', { offsetX: 100 })
        cy.get('.panel-editable .rst__node').should('have.length', 3)
        cy.get('.panel-uneditable .rst__node').should('have.length', 2)
        cy.then(() => {
          expect(messagesFromWidget.length).to.equal(2)
          expect((messagesFromWidget[0] as SignalMessage).signal.type).to.equal('loaded')
          expect((messagesFromWidget[1] as SignalMessage).treeData).to.deep.equal({
            type: 'collection',
            title: 'test collection',
            slug: 'test',
            children: [{
              type: 'subcollection',
              title: 'subcollection',
              expanded: true,
              children: [{
                type: 'module',
                subtitle: 'm00002',
                title: 'Appendix'
              }, {
                type: 'module',
                subtitle: 'm00001',
                title: 'Introduction'
              }]
            }]
          })
        })
      })
      it('deletes elements when dnd from editable to uneditable', () => {
        cy.get('.panel-editable .rst__node:nth-child(3) .rst__moveHandle')
          .dnd('.panel-uneditable .rst__node:nth-child(1) .rst__nodeContent')
        cy.get('.panel-editable .rst__node').should('have.length', 2)
        cy.get('.panel-uneditable .rst__node').should('have.length', 2)
        cy.then(() => {
          expect(messagesFromWidget.length).to.equal(2)
          expect((messagesFromWidget[0] as SignalMessage).signal.type).to.equal('loaded')
          expect((messagesFromWidget[1] as SignalMessage).treeData).to.deep.equal({
            type: 'collection',
            title: 'test collection',
            slug: 'test',
            children: [{
              type: 'subcollection',
              title: 'subcollection',
              expanded: true,
              children: [{
                type: 'module',
                subtitle: 'm00001',
                title: 'Introduction'
              }]
            }]
          })
        })
      })
      it('disallows modules from having children', () => {
        cy.get('.panel-uneditable .rst__node:nth-child(1) .rst__moveHandle')
          .dnd('.panel-editable .rst__node:nth-child(3) .rst__nodeContent', { offsetX: 100 })
        cy.get('.panel-editable .rst__node').should('have.length', 3)
        cy.get('.panel-uneditable .rst__node').should('have.length', 2)
        cy.then(() => {
          expect(messagesFromWidget.length).to.equal(1)
          expect((messagesFromWidget[0] as SignalMessage).signal.type).to.equal('loaded')
        })
      })
    })

    describe('controls', () => {
      beforeEach(() => {
        sendTreeData([{
          type: 'collection',
          title: 'test collection',
          slug: 'test',
          children: [{
            type: 'subcollection',
            title: 'subcollection',
            expanded: true,
            children: [{
              type: 'module',
              subtitle: 'm00001',
              title: 'Introduction'
            }, {
              type: 'module',
              subtitle: 'm00005',
              title: 'Appending To Lists'
            }]
          }, {
            type: 'module',
            subtitle: 'm00002',
            title: 'Appendix'
          }]
        }, {
          type: 'collection',
          title: 'test collection 2',
          slug: 'test-2',
          children: [{
            type: 'subcollection',
            title: 'subcollection',
            expanded: true,
            children: [{
              type: 'module',
              subtitle: 'm00001',
              title: 'Introduction'
            }, {
              type: 'module',
              subtitle: 'm00006',
              title: 'Deleting From Lists'
            }]
          }, {
            type: 'module',
            subtitle: 'm00002',
            title: 'Appendix'
          }]
        }], [{
          type: 'mock',
          title: 'mock',
          slug: 'mock',
          children: [{
            type: 'module',
            subtitle: 'm00003',
            title: 'Module 3'
          }, {
            type: 'module',
            subtitle: 'm00004',
            title: 'Module 4'
          }]
        }])
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
      it('switches between trees', () => {
        cy.get('.panel-editable .search')
          .type('deleting')
        cy.get('.panel-editable .search-info').should('contain.text', '0 / 0')
        cy.get('.panel-editable .tree-select')
          .select('test collection 2')
        cy.get('.panel-editable .search-info').should('contain.text', '1 / 1')
      })
    })
  })
}
