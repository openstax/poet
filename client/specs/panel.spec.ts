import Sinon from 'sinon'
import expect from 'expect'
import { Disposer, ExtensionHostContext, Panel, PanelManager } from '../src/panel'
import { Disposable, WebviewPanel } from 'vscode'

describe('panel', () => {
  const sinon = Sinon.createSandbox()

  class TestPanel extends Panel<boolean, string, null> {
    public webviewPanel: WebviewPanel
    constructor() {
      super({
        visible: false,
        webview: {
          postMessage: () => {},
          onDidReceiveMessage: () => new Disposable(sinon.stub())
        },
        reveal: sinon.stub(),
        dispose: sinon.stub(),
        onDidDispose: sinon.stub()
      } as unknown as WebviewPanel)
      this.webviewPanel = this.panel
    }

    protected getState() { return null }

    async handleMessage(message: boolean) {}
  }

  afterEach(() => sinon.restore())

  it('handles onDidDispose', () => {
    const panel = new TestPanel()
    const onDidDisposeListener = sinon.stub()
    panel.onDidDispose(onDidDisposeListener)
    panel.dispose()
    expect(onDidDisposeListener.callCount).toBe(1)
  })

  it('handles postMessage', async () => {
    const panel = new TestPanel()
    const stub = sinon.stub(panel.webviewPanel.webview, 'postMessage')
    await panel.postMessage('woot')
    expect(stub.firstCall.args[0]).toBe('woot')

    // Dispose and try to post again
    panel.dispose()
    await panel.postMessage('woot2')
    expect(stub.callCount).toBe(1)
  })

  it('relays visibility from inner panel', async () => {
    const panel = new TestPanel()
    expect(panel.visible()).toBe(false)
  })

  describe('PanelManager', () => {
    const context = {} as unknown as ExtensionHostContext
    const pm = new PanelManager(context, TestPanel)
    it('Various permutations', () => {
      expect(pm.panel()).toBe(null)

      pm.revealOrNew()
      const p1 = pm.panel()
      expect(p1).not.toBe(null)

      pm.revealOrNew()
      expect(pm.panel()).toBe(p1)

      pm.newPanel()
      const p2 = pm.panel()
      expect(p2).not.toBe(p1)
    })
  })

  describe('Disposer', () => {
    it('ignores registering more listeners when the panel is disposed', () => {
      const stub1 = sinon.stub()
      const stub2 = sinon.stub()
      const d = new Disposer()
      d.registerDisposable(new Disposable(stub1))
      expect(stub1.called).toBe(false)

      d.dispose()
      expect(stub1.called).toBe(true)
      d.registerDisposable(new Disposable(stub2))

      expect(stub2.callCount).toBe(1)

      // Do not double-dispose
      d.dispose()
      expect(stub2.callCount).toBe(1)
    })
  })
})
