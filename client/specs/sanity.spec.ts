import { join } from 'path'

import { activate, deactivate } from '../src/extension'
import { ExtensionContext } from 'vscode'

describe('Simple extension activation/deactivation', () => {
  afterEach(async () => await deactivate())
  it('Sanity: starts extension', async function () {
    const extensionContext = {
      asAbsolutePath: (p: string) => join(__dirname, '..', '..', p)
    } as unknown as ExtensionContext
    await activate(extensionContext)
  })
})
