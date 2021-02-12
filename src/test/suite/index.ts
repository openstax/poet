import fs from 'fs'
import path from 'path'
import Mocha from 'mocha'
import glob from 'glob'

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
    color: true
  })

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
        console.error(err)
        reject(err)
      }
    })
  }).finally(() => {
    console.log('Extracting the code coverage from __coverage__ and writing it to .nyc_output/coverage.json')
    fs.writeFileSync(path.join(__dirname, '../../../.nyc_output/coverage.json'), JSON.stringify((global as any).__coverage__))
  })
}
