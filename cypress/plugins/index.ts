// ***********************************************************
// See https://on.cypress.io/plugins-guide
// This function is called when a project is opened or re-opened (e.g. due to
// the project's config changing)

import * as CoverageTask from '@cypress/code-coverage/task'

/**
 * @type {Cypress.PluginConfig}
 */
export = (on, config) => {
  // `on` is used to hook into various events Cypress emits
  // `config` is the resolved Cypress config

  CoverageTask(on, config)
  return config
}
