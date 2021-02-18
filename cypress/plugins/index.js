/// <reference types="cypress" />
// ***********************************************************
// This example plugins/index.js can be used to load plugins
// https://on.cypress.io/plugins-guide
// This function is called when a project is opened or re-opened (e.g. due to
// the project's config changing)

/**
 * @type {Cypress.PluginConfig}
 */
module.exports = (on, config) => {
  // `on` is used to hook into various events Cypress emits
  // `config` is the resolved Cypress config

  require('@cypress/code-coverage/task')(on, config)
  return config
}
