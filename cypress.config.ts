import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: null,
    setupNodeEvents(on, config) {
      require('@cypress/code-coverage/task')(on, config)
      return config
    },
  }
})