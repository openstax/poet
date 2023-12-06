import Sinon from 'sinon'
import { requestEnsureIds, requestGenerateReadme } from '../../common/src/requests'
import { expect } from '@jest/globals'

describe('ensureIds', () => {
  const sinon = Sinon.createSandbox()
  afterEach(() => { sinon.restore() })

  it('runs and yields a response', async () => {
    const client = {
      sendRequest: sinon.stub()
    }
    await requestEnsureIds(client, { workspaceUri: '/fake/workspace' })
    expect(client.sendRequest.firstCall.args).toMatchSnapshot()
  })
})

describe('generateReadme', () => {
  const sinon = Sinon.createSandbox()
  afterEach(() => { sinon.restore() })

  it('runs and yields a response', async () => {
    const client = {
      sendRequest: sinon.stub()
    }
    await requestGenerateReadme(client, { workspaceUri: '/fake/workspace' })
    expect(client.sendRequest.firstCall.args).toMatchSnapshot()
  })
})
