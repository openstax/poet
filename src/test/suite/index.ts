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

  const testsRoot = path.resolve(__dirname, '..')

  return new Promise<void>((resolve, reject) => {
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
        console.error(err)
        reject(err)
      }
    })
  }).finally(() => {
    const destDir = path.join(__dirname, '../../../.nyc_output')
    const dest = path.join(destDir, 'coverage.json')
    const coverage = (global as any).__coverage__
    if (!coverage) { throw new Error('Did not collect code coverage') }
    console.log(`Extracting the code coverage from __coverage__ and writing it to ${dest}`)
    mkdirpSync(destDir)
    fs.writeFileSync(dest, JSON.stringify(coverage))
  })
}
