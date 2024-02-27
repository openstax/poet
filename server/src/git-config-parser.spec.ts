import { expect } from '@jest/globals'
import { parseGitConfig } from './git-config-parser'

describe('Git config parser', () => {
  it('parses well-formatted config as expected', () => {
    const config = `\
[submodule "private"]
    path = private
    url = super-cool-url
    branch = super-cool-branch
`
    const sections = parseGitConfig(config)
    expect(sections['submodule.private.path']).toBe('private')
    expect(sections['submodule.private.url']).toBe('super-cool-url')
    expect(sections['submodule.private.branch']).toBe('super-cool-branch')
  })
  it('parses some more interesting stuff', () => {
    const config = `\
rootlevelproperty = ignored
[core]
        filemode =          true
        bare         =      false
        logallrefupdates  = true
              ignorecase  = true
        precomposeunicode = true
`
    const sections = parseGitConfig(config)
    expect(sections['root-level-property']).not.toBeDefined()
    expect(sections['core.bare']).toBe('false')
    expect(sections['core.ignorecase']).toBe('true')
  })
})
