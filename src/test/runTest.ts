import path from 'path'

import { runTests } from 'vscode-test'

async function main(): Promise<void> {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../')

    // The path to test runner
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index')

    const testDataFolder = path.resolve(extensionDevelopmentPath, 'out-instrumented/test/data/test-repo')

    // Download VS Code, unzip it and run the integration test
    await runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs: [testDataFolder, '--disable-extensions'] })
  } catch (err) {
    console.error('Failed to run tests')
    process.exit(1)
  }
}

main().catch((err) => { throw new Error(err) })
