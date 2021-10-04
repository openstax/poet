import Sinon from 'sinon'
import { requestEnsureIds } from '../../common/src/requests'
import expect from 'expect'

describe('ensureIds', () => {
  const sinon = Sinon.createSandbox()
  afterEach(() => sinon.restore())

  it('runs and yields a response', async () => {
    const client = {
      sendRequest: sinon.stub()
    }
    await requestEnsureIds(client, { workspaceUri: '/fake/workspace' })
    expect(client.sendRequest.firstCall.args).toMatchSnapshot()
  })
})
