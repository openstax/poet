/** @type {import('@ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: [
      'client/specs',
      'server/src'
    ],
    detectOpenHandles: true,
    testPathIgnorePatterns: [
      '/out/'
    ]
  }
  