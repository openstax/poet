import fs from 'fs'
import path from 'path'
import Mocha from 'mocha'
import glob from 'glob'
import { mkdirpSync } from 'fs-extra'

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
    color: true
  })

  const REPO_ROOT = path.resolve(__dirname, '../../../../')
  const testsRoot = path.resolve(__dirname, '..')

  return await new Promise<void>((resolve, reject) => {
    glob('**/**.test.js', { cwd: testsRoot }, (err, files) => {
      if (err != null) {
        return reject(err)
      }

      // Add files to the test suite
      files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)))

      try {
        // Run the mocha test
        mocha.run(failures => {
          if (failures > 0) {
            reject(new Error(`${failures} tests failed.`))
          } else {
            resolve()
          }
        })
      } catch (err) {
        const e = err as Error
        console.error(e)
        console.error('errorstack', e.stack)
        reject(e)
      }
    })
  }).finally(() => {
    const destDir = path.join(REPO_ROOT, '.nyc_output')
    const dest = path.join(destDir, 'coverage-vscode-tests.json')
    const coverage = (global as any).__coverage__
    if (coverage === undefined) {
      console.error('Did not find coverage data on global.__coverage__ . Failing')
      throw new Error('Did not collect code coverage')
    }
    // Change all the paths to include ./client/...
    console.log(`Extracting the code coverage from __coverage__ and writing it to ${dest}`)
    mkdirpSync(destDir)
    fs.writeFileSync(dest, JSON.stringify(coverage))
  })
}
