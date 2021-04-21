// Shares a namespace with the other specfiles if not scoped
import { PanelIncomingMessage, PanelOutgoingMessage, WriteTreeSignal } from '../../client/src/panel-toc-editor'
{
  // The HTML file that cypress should load when running tests (relative to the project root)
  const htmlPath = './client/out/client/src/toc-editor.html'

  describe('toc-editor Webview Tests', () => {
    function sendMessage(msg: PanelOutgoingMessage): void {
      cy.window().then($window => {
        $window.postMessage(msg, '*')
      })
    }

    // When the browser calls vscode.postMessage(...) that message is added to this array
    let messagesFromWidget: PanelIncomingMessage[] = []
    // When the browser calls vscode.setState, that state is stored here
    let pageState: any

    beforeEach(() => {
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
    it('will load when a message is sent (unreliable state store)', () => {
      cy.then(() => {
        messagesFromWidget = []
      })
      cy.visit(htmlPath, {
        onBeforeLoad: (contentWindow) => {
          class API {
            postMessage(msg: PanelIncomingMessage): void { messagesFromWidget.push(msg) }
            getState(): any { return undefined }
            setState(_state: any): void { return }
          }
          (contentWindow as any).acquireVsCodeApi = () => { return new API() }
        }
      })
      sendMessage({
        editable: [],
        uneditable: []
      })
      cy.get('[data-app-init]').should('exist')
      cy.get('.panel-editable .rst__node').should('not.exist')
      cy.get('.panel-uneditable .rst__node').should('not.exist')
      cy.then(() => {
        expect(messagesFromWidget).to.have.length(1)
        expect(messagesFromWidget[0]).to.deep.equal({ type: 'refresh' })
      })
    })
    it('will load when a message is sent (empty)', () => {
      sendMessage({
        editable: [],
        uneditable: []
      })
      cy.get('[data-app-init]').should('exist')
      cy.get('.panel-editable .rst__node').should('not.exist')
      cy.get('.panel-uneditable .rst__node').should('not.exist')
      cy.then(() => {
        expect(messagesFromWidget).to.have.length(1)
        expect(messagesFromWidget[0]).to.deep.equal({ type: 'refresh' })
      })
    })
    it('will load when a message is sent', () => {
      sendMessage({
        editable: [{
          type: 'collection',
          title: 'test collection',
          slug: 'test',
          children: [{
            type: 'subcollection',
            title: 'subcollection',
            children: [{
              type: 'module',
              moduleid: 'm00001',
              subtitle: 'm00001',
              title: 'Introduction'
            }]
          }, {
            type: 'module',
            moduleid: 'm00002',
            subtitle: 'm00002',
            title: 'Appendix'
          }]
        }],
        uneditable: []
      })
      cy.get('[data-app-init]').should('exist')
      cy.get('.panel-editable .rst__node').should('have.length', 2)
      cy.get('.panel-uneditable .rst__node').should('not.exist')
      cy.then(() => {
        expect(messagesFromWidget).to.have.length(1)
        expect(messagesFromWidget[0]).to.deep.equal({ type: 'refresh' })
      })
    })
    it('will load when a message is sent (expanded)', () => {
      sendMessage({
        editable: [{
          type: 'collection',
          title: 'test collection',
          slug: 'test',
          children: [{
            type: 'subcollection',
            title: 'subcollection',
            expanded: true,
            children: [{
              type: 'module',
              moduleid: 'm00001',
              subtitle: 'm00001',
              title: 'Introduction'
            }]
          }, {
            type: 'module',
            moduleid: 'm00002',
            subtitle: 'm00002',
            title: 'Appendix'
          }]
        }],
        uneditable: []
      })
      cy.get('[data-app-init]').should('exist')
      cy.get('.panel-editable .rst__node').should('have.length', 3)
      cy.get('.panel-uneditable .rst__node').should('not.exist')
      cy.then(() => {
        expect(messagesFromWidget).to.have.length(1)
        expect(messagesFromWidget[0]).to.deep.equal({ type: 'refresh' })
      })
    })
    it('will not re-render on same data (expanded)', () => {
      const message: PanelOutgoingMessage = {
        editable: [{
          type: 'collection',
          title: 'test collection',
          slug: 'test',
          children: [{
            type: 'subcollection',
            title: 'subcollection',
            children: [{
              type: 'module',
              moduleid: 'm00001',
              subtitle: 'm00001',
              title: 'Introduction'
            }]
          }]
        }],
        uneditable: []
      }
      sendMessage(message)
      cy.get('[data-render-cached]').should('not.exist')
      sendMessage(message)
      cy.get('[data-render-cached]').should('exist')
      sendMessage({
        editable: [{
          type: 'collection',
          title: 'test collection',
          slug: 'test',
          children: [{
            type: 'subcollection',
            title: 'subcollection',
            children: [{
              type: 'module',
              moduleid: 'm00001',
              subtitle: 'm00001',
              title: 'Introduction'
            }]
          }, {
            type: 'module',
            moduleid: 'm00002',
            subtitle: 'm00002',
            title: 'Appendix'
          }]
        }],
        uneditable: []
      })
      cy.get('[data-render-cached]').should('not.exist')
    })
    it('will not re-render on same data (expanded)', () => {
      const message: PanelOutgoingMessage = {
        editable: [{
          type: 'collection',
          title: 'test collection',
          slug: 'test',
          children: [{
            type: 'subcollection',
            title: 'subcollection',
            expanded: true,
            children: [{
              type: 'module',
              moduleid: 'm00001',
              subtitle: 'm00001',
              title: 'Introduction'
            }]
          }]
        }],
        uneditable: []
      }
      sendMessage(message)
      cy.get('[data-render-cached]').should('not.exist')
      sendMessage(message)
      cy.get('[data-render-cached]').should('exist')
      sendMessage({
        editable: [{
          type: 'collection',
          title: 'test collection',
          slug: 'test',
          children: [{
            type: 'subcollection',
            title: 'subcollection',
            expanded: true,
            children: [{
              type: 'module',
              moduleid: 'm00001',
              subtitle: 'm00001',
              title: 'Introduction'
            }]
          }, {
            type: 'module',
            moduleid: 'm00002',
            subtitle: 'm00002',
            title: 'Appendix'
          }]
        }],
        uneditable: []
      })
      cy.get('[data-render-cached]').should('not.exist')
    })
    it('will preserve expanded nodes on reload', () => {
      sendMessage({
        editable: [{
          type: 'collection',
          title: 'test collection',
          slug: 'test',
          children: [{
            type: 'subcollection',
            title: 'subcollection',
            expanded: true,
            children: [{
              type: 'module',
              moduleid: 'm00001',
              subtitle: 'm00001',
              title: 'Introduction'
            }]
          }, {
            type: 'subcollection',
            title: 'subcollection',
            children: [{
              type: 'module',
              moduleid: 'm00001',
              subtitle: 'm00001',
              title: 'Introduction'
            }]
          }]
        }],
        uneditable: []
      })
      cy.get('.panel-editable .rst__node').should('have.length', 3)
      sendMessage({
        editable: [{
          type: 'collection',
          title: 'test collection',
          slug: 'test',
          children: [{
            type: 'subcollection',
            title: 'subcollection',
            expanded: true,
            children: [{
              type: 'module',
              moduleid: 'm00001',
              subtitle: 'm00001',
              title: 'Introduction'
            }]
          }, {
            type: 'subcollection',
            title: 'subcollection',
            children: [{
              type: 'module',
              moduleid: 'm00001',
              subtitle: 'm00001',
              title: 'Introduction'
            }]
          }, {
            type: 'subcollection',
            title: 'subcollection',
            children: [{
              type: 'module',
              moduleid: 'm00001',
              subtitle: 'm00001',
              title: 'Introduction'
            }]
          }]
        }],
        uneditable: []
      })
      // Would be 3 if the expanded subcollection was not preserved
      cy.get('.panel-editable .rst__node').should('have.length', 4)
    })

    describe('drag-n-drop', () => {
      beforeEach(() => {
        sendMessage({
          editable: [{
            type: 'collection',
            title: 'test collection',
            slug: 'test',
            children: [{
              type: 'subcollection',
              title: 'subcollection',
              expanded: true,
              children: [{
                type: 'module',
                moduleid: 'm00001',
                subtitle: 'm00001',
                title: 'Introduction'
              }]
            }, {
              type: 'module',
              moduleid: 'm00002',
              subtitle: 'm00002',
              title: 'Appendix'
            }]
          }],
          uneditable: [{
            type: 'collection',
            title: 'mock',
            slug: 'mock',
            children: [{
              type: 'module',
              moduleid: 'm00003',
              subtitle: 'm00003',
              title: 'Module 3'
            }, {
              type: 'module',
              moduleid: 'm00004',
              subtitle: 'm00004',
              title: 'Module 4'
            }]
          }]
        })
      })
      it('allows dnd from uneditable to editable', () => {
        cy.get('.panel-uneditable .rst__node:nth-child(1) .rst__moveHandle')
          .dnd('.panel-editable .rst__node:nth-child(2) .rst__nodeContent')
        cy.get('.panel-editable .rst__node').should('have.length', 4)
        cy.get('.panel-uneditable .rst__node').should('have.length', 2)
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(2)
          expect(messagesFromWidget[0]).to.deep.equal({ type: 'refresh' })
          expect(messagesFromWidget[1]).to.deep.equal({
            type: 'write-tree',
            treeData: {
              type: 'collection',
              title: 'test collection',
              slug: 'test',
              children: [{
                type: 'subcollection',
                title: 'subcollection',
                expanded: true,
                children: [{
                  type: 'module',
                  moduleid: 'm00003',
                  subtitle: 'm00003',
                  title: 'Module 3'
                }, {
                  type: 'module',
                  moduleid: 'm00001',
                  subtitle: 'm00001',
                  title: 'Introduction'
                }]
              }, {
                type: 'module',
                moduleid: 'm00002',
                subtitle: 'm00002',
                title: 'Appendix'
              }]
            }
          })
        })
      })
      it('allows dnd from editable to editable', () => {
        cy.get('.panel-editable .rst__node:nth-child(3) .rst__moveHandle')
          .dnd('.panel-editable .rst__node:nth-child(2) .rst__nodeContent', { offsetX: 100 })
        cy.get('.panel-editable .rst__node').should('have.length', 3)
        cy.get('.panel-uneditable .rst__node').should('have.length', 2)
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(2)
          expect(messagesFromWidget[0]).to.deep.equal({ type: 'refresh' })
          expect(messagesFromWidget[1]).to.deep.equal({
            type: 'write-tree',
            treeData: {
              type: 'collection',
              title: 'test collection',
              slug: 'test',
              children: [{
                type: 'subcollection',
                title: 'subcollection',
                expanded: true,
                children: [{
                  type: 'module',
                  moduleid: 'm00002',
                  subtitle: 'm00002',
                  title: 'Appendix'
                }, {
                  type: 'module',
                  moduleid: 'm00001',
                  subtitle: 'm00001',
                  title: 'Introduction'
                }]
              }]
            }
          })
        })
      })
      it('deletes elements when dnd from editable to uneditable', () => {
        cy.get('.panel-editable .rst__node:nth-child(3) .rst__moveHandle')
          .dnd('.panel-uneditable .rst__node:nth-child(1) .rst__nodeContent')
        cy.get('.panel-editable .rst__node').should('have.length', 2)
        cy.get('.panel-uneditable .rst__node').should('have.length', 2)
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(2)
          expect(messagesFromWidget[0]).to.deep.equal({ type: 'refresh' })
          expect(messagesFromWidget[1]).to.deep.equal({
            type: 'write-tree',
            treeData: {
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
                  moduleid: 'm00001',
                  title: 'Introduction'
                }]
              }]
            }
          })
        })
      })
      it('disallows modules from having children', () => {
        cy.get('.panel-uneditable .rst__node:nth-child(1) .rst__moveHandle')
          .dnd('.panel-editable .rst__node:nth-child(3) .rst__nodeContent', { offsetX: 100 })
        cy.get('.panel-editable .rst__node').should('have.length', 3)
        cy.get('.panel-uneditable .rst__node').should('have.length', 2)
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(1)
          expect(messagesFromWidget[0]).to.deep.equal({ type: 'refresh' })
        })
      })
    })

    describe('controls', () => {
      beforeEach(() => {
        sendMessage({
          editable: [{
            type: 'collection',
            title: 'test collection',
            slug: 'test',
            children: [{
              type: 'subcollection',
              title: 'subcollection',
              expanded: true,
              children: [{
                type: 'module',
                moduleid: 'm00001',
                subtitle: 'm00001',
                title: 'Introduction'
              }, {
                type: 'module',
                moduleid: 'm00005',
                subtitle: 'm00005',
                title: 'Appending To Lists'
              }]
            }, {
              type: 'module',
              moduleid: 'm00002',
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
                moduleid: 'm00001',
                subtitle: 'm00001',
                title: 'Introduction'
              }, {
                type: 'module',
                moduleid: 'm00006',
                subtitle: 'm00006',
                title: 'Deleting From Lists'
              }]
            }, {
              type: 'module',
              moduleid: 'm00002',
              subtitle: 'm00002',
              title: 'Appendix'
            }]
          }],
          uneditable: [{
            type: 'collection',
            title: 'mock',
            slug: 'mock',
            children: [{
              type: 'module',
              moduleid: 'm00003',
              subtitle: 'm00003',
              title: 'Module 3'
            }, {
              type: 'module',
              moduleid: 'm00004',
              subtitle: 'm00004',
              title: 'Module 4'
            }]
          }]
        })
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
        cy.get('.panel-editable .search-next').click({force: true})
        cy.get('.panel-editable .search-info').should('contain.text', '0 / 0')
        cy.get('.panel-editable .rst__rowSearchFocus').should('not.exist')
        cy.get('.panel-editable .search-prev').should('be.disabled')
        cy.get('.panel-editable .search-prev').click({force: true})
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
      it('can tell the extension to create module', () => {
        cy.get('.panel-uneditable .module-create')
          .click()
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(2)
          expect(messagesFromWidget[0]).to.deep.equal({ type: 'refresh' })
          expect(messagesFromWidget[1]).to.deep.equal({ type: 'module-create' })
        })
      })
      it('can tell the extension to create subcollection', () => {
        cy.get('.panel-editable .subcollection-create')
          .click()
        cy.get('.panel-editable .tree-select')
          .select('test collection 2')
        cy.get('.panel-editable .subcollection-create')
          .click()
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(3)
          expect(messagesFromWidget[0]).to.deep.equal({ type: 'refresh' })
          expect(messagesFromWidget[1]).to.deep.equal({ type: 'subcollection-create', slug: 'test' })
          expect(messagesFromWidget[2]).to.deep.equal({ type: 'subcollection-create', slug: 'test-2' })
        })
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
      it('can tell the extension to rename module', () => {
        cy.get('.panel-editable .node-title')
          .eq(1)
          .click()
          .should('not.exist')
        cy.get('.panel-editable .node-title-rename')
          .eq(0)
          .type('abc', { delay: 50 })
          .blur()
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(2)
          expect(messagesFromWidget[0]).to.deep.equal({ type: 'refresh' })
          expect(messagesFromWidget[1]).to.deep.equal({ type: 'module-rename', moduleid: 'm00001', newName: 'Introductionabc' })
        })
      })
      it('can tell the extension to rename subcollection', () => {
        cy.get('.panel-editable .node-title')
          .eq(0)
          .click()
          .should('not.exist')
        cy.get('.panel-editable .node-title-rename')
          .eq(0)
          .type('abc', { delay: 50 })
          .blur()
        cy.then(() => {
          expect(messagesFromWidget).to.have.length(2)
          expect(messagesFromWidget[0]).to.deep.equal({ type: 'refresh' })
          expect((messagesFromWidget[1] as WriteTreeSignal).treeData.children[0].title).to.equal('subcollectionabc')
        })
      })
    })
  })
}
