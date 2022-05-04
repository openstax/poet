import assert from 'assert'
import { setResourceRootDir } from '../../extension'

suite('Dummy Test Suite', () => {
  test('Dummy test', () => {
    setResourceRootDir('just-enough-to-trigger-code-coverage-to-be-counted')
    assert(true)
  })
})
