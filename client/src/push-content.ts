import vscode from 'vscode'
import { expect, getErrorDiagnosticsBySource, getRootPathUri } from './utils'
import { type GitExtension, GitErrorCodes, type CommitOptions, type Repository, Status } from './git-api/git'
import { type ExtensionHostContext } from './panel'
import { DiagnosticSource, requestEnsureIds, requestGetSubmoduleConfig } from '../../common/src/requests'
import { type LanguageClient } from 'vscode-languageclient/node'

const PRIVATE_SUBMODULE_NAME = 'private'

export enum DocumentsToOpen {
  all = 'All Content',
  modified = 'Modified Content'
}

export const PushValidationModal = {
  poetErrorMsg: 'There are outstanding validation errors that must be resolved before pushing is allowed.',
  xmlErrorMsg: 'There are outstanding schema errors that must be resolved before pushing is allowed.',
  duplicateFileNamesErrorMsg: ' have the same name. They should be renamed or deleted before pushing is allowed.'
}

export const getDocumentsToOpen = async (checkType: DocumentsToOpen): Promise<Set<string>> => {
  if (checkType === DocumentsToOpen.modified) {
    const repo = getBookRepo()
    return new Set(
      repo.state.workingTreeChanges
        .filter(change =>
          change.status !== Status.DELETED &&
          change.status !== Status.DELETED_BY_THEM &&
          change.status !== Status.DELETED_BY_US &&
          change.status !== Status.BOTH_DELETED
        )
        .map(change => change.uri.toString())
        .filter(uriString =>
          uriString.endsWith('.xml') || uriString.endsWith('.cnxml') || uriString.endsWith('.xhtml')
        )
    )
  } else {
    // Open all *.*x*ml (could be xml, cnxml, xhtml, etc.)
    return new Set((await vscode.workspace.findFiles('**/*.*x*ml')).map(uri => uri.toString()))
  }
}

export const closeValidDocuments = async (
  openedEditors: vscode.TextEditor[],
  errorsBySource: Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>
) => {
  const urisWithErrors = new Set<string>()
  for (const errors of errorsBySource.values()) {
    errors.forEach(e => urisWithErrors.add(e[0].toString()))
  }
  for (const editor of openedEditors) {
    const editorUri = editor.document.uri
    if (!urisWithErrors.has(editorUri.toString())) {
      // Move to the editor with no errors and then close it
      await vscode.window.showTextDocument(editorUri)
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    }
  }
}

export const progressWithTimeEst = async<T>(
  message: string,
  task: (
    progress: vscode.Progress<{ increment: number }>,
    token: vscode.CancellationToken
  ) => Thenable<T>
) => {
  const options = {
    location: vscode.ProgressLocation.Notification,
    cancellable: true
  }
  return await vscode.window.withProgress(options, async (progress, token) => {
    const startTime = Date.now() - 1 // Prevent division by 0
    let percentDone = 0
    // Wrap the vscode progress report in a custom reporter that estimates remaining time
    const customProgressReporter: vscode.Progress<{ increment: number }> = {
      report: (value: { increment: number }) => {
        percentDone += value.increment
        if (percentDone > 0) {
          const elapsedMS = Date.now() - startTime
          const remainingMS = Math.ceil((100 - percentDone) / (percentDone / elapsedMS))
          const remainingS = Math.floor(remainingMS / 1000) % 60
          const remainingM = Math.floor(remainingMS / 1000 / 60)
          progress.report({
            message: `${message} (${remainingM}m${remainingS}s${remainingMS % 1000}ms remaining)`,
            increment: value.increment
          })
        } else {
          progress.report({ message })
        }
      }
    }
    return await task(customProgressReporter, token)
  })
}

/* istanbul ignore next */
export const sleep = async (milliseconds: number) => {
  await new Promise((resolve, reject) => setTimeout(resolve, milliseconds))
}

export const openAndValidate = async (checkType: DocumentsToOpen) => {
  const documentsToOpen = await getDocumentsToOpen(checkType)
  // When you open an editor, it can take some time for error diagnostics to be reported.
  // Give the language server a second to report errors.
  const getDelayedDiagnostics = async () => {
    await sleep(1000)
    return getErrorDiagnosticsBySource()
  }
  const ret = await progressWithTimeEst(
    'Opening documents with errors...',
    async (progress, token) => {
      const openedEditors: vscode.TextEditor[] = []
      const increment = 1 / documentsToOpen.size * 100
      const waitTime = 5000
      let lastIteration = Date.now()
      progress.report({ increment: 0 })
      for (const uri of documentsToOpen) {
        if (token.isCancellationRequested) {
          return undefined
        }
        openedEditors.push(
          await vscode.window.showTextDocument(vscode.Uri.parse(uri), { preview: false })
        )
        if (Date.now() - lastIteration >= waitTime) {
          await closeValidDocuments(openedEditors, await getDelayedDiagnostics())
          progress.report({ increment: increment * openedEditors.length })
          openedEditors.splice(0) // Clear the array
          lastIteration = Date.now()
        }
      }
      const errorsBySource = await getDelayedDiagnostics()
      if (openedEditors.length > 0) {
        await closeValidDocuments(openedEditors, errorsBySource)
      }
      return errorsBySource
    }
  )
  if (ret === undefined) throw new Error('Canceled')
  return ret
}

export const validateContent = async () => {
  const type = await vscode.window.showInformationMessage(
    'Validate all content, or just modified content?',
    { modal: true },
    DocumentsToOpen.modified,
    DocumentsToOpen.all
  )
  if (type !== undefined) {
    await openAndValidate(type)
  }
}

export const canPush = (errorsBySource: Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>): boolean => {
  if (errorsBySource.has(DiagnosticSource.poet)) {
    void vscode.window.showErrorMessage(PushValidationModal.poetErrorMsg, { modal: true })
    return false
  }
  if (errorsBySource.has(DiagnosticSource.xml)) {
    void vscode.window.showErrorMessage(PushValidationModal.xmlErrorMsg, { modal: true })
    return false
  }
  return true
}

export const getRepos = () => {
  const gitExtension = expect(vscode.extensions.getExtension<GitExtension>('vscode.git'), 'Expected vscode.git extension to be installed').exports
  const api = gitExtension.getAPI(1)
  return api.repositories
}

export const getRepo = (pathHint: string): Repository | undefined => {
  // Note: It may seem like api.getRepository would be a valid replacement for this; however,
  // api.getRepository always returns at least one repository (assuming there is at least one),
  // regardless of the uri supplied
  const results = getRepos().filter(r => r.rootUri.fsPath.endsWith(pathHint))
  /* istanbul ignore next */
  if (results.length > 1) {
    throw new Error(`"${pathHint}" matched more than one repository`)
  }
  return results[0]
}

export const getBookRepo = (): Repository => {
  // NOTE: This assumes that the book is the root repository
  const uri = expect(getRootPathUri(), 'Could not get workspace root')
  return expect(getRepo(uri.fsPath), 'Could not get book repository')
}

export const setDefaultGitConfig = async (): Promise<void> => {
  for (const repo of getRepos()) {
    const config = await repo.getConfigs()
    if (!config.some(p => p.key === 'pull.ff' || p.key === 'pull.rebase')) {
      await repo.setConfig('pull.ff', 'true')
    }
  }
}

export const validateMessage = (message: string): string | null => {
  return message.length > 2 ? null : 'Too short!'
}

export const getMessage = async (): Promise<string | undefined> => {
  const message = await vscode.window.showInputBox({
    prompt: 'Push Message: ',
    placeHolder: '...',
    validateInput: validateMessage
  })
  return message
}

// NOTE: When the private submodule is not initialized, this will return undefined
export const _getPrivateSubmodule = () => getRepo(PRIVATE_SUBMODULE_NAME)

/* istanbul ignore next (already tested in pushContent) */
export const initPrivateSubmodule = async (hostContext: ExtensionHostContext) => {
  const privateSubmodule = _getPrivateSubmodule()
  if (privateSubmodule !== undefined) {
    await preparePrivateSubmodule(hostContext.client, privateSubmodule)
  } else {
    console.warn(`Private submodule not found: ${PRIVATE_SUBMODULE_NAME}`)
  }
}

export const preparePrivateSubmodule = async (
  client: LanguageClient,
  privateSubmodule: Repository
): Promise<void> => {
  // TODO: What if submodule needs to be initialized? (not a problem in gitpod)
  const uri = expect(getRootPathUri(), 'Could not get root path')
  const maybeGitModules = await requestGetSubmoduleConfig(
    client,
    { workspaceUri: uri.toString() }
  )
  const submoduleBranch = expect(
    maybeGitModules?.[`submodule.${PRIVATE_SUBMODULE_NAME}.branch`],
    'Could not determine which private submodule branch to use'
  )
  try {
    await privateSubmodule.fetch()
    await privateSubmodule.checkout(submoduleBranch)
  } catch (e) {
    console.error(e)
    throw new Error(
      `Could not checkout private submodule branch: ${submoduleBranch}`
    )
  }
}

export const pushContent = (hostContext: ExtensionHostContext) => async () => {
  // Do a precursory check for known errors (fast!)
  if (canPush(getErrorDiagnosticsBySource())) {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Push Content',
      cancellable: true
    }, async (progress, token) => {
      token.onCancellationRequested(() => {
        /* istanbul ignore next */
        console.log('User canceled the push operation')
      })
      // indeterminate progress https://github.com/Microsoft/vscode/issues/47387#issuecomment-379537556
      progress.report({ message: 'Creating Auto Element IDs, please wait...' })
      // const serverErrorMessage = 'Server cannot properly find workspace'
      const uri = expect(getRootPathUri(), 'No root path in which to generate a module')
      const pushTargets = [getBookRepo()]
      // fix ids
      // TODO: better ui in future. Add `increment` value in `progress.report` and use a callback to update real progress
      await requestEnsureIds(hostContext.client, { workspaceUri: uri.toString() })
      const privateSubmodule = _getPrivateSubmodule()
      if (privateSubmodule !== undefined) {
        try {
          await preparePrivateSubmodule(hostContext.client, privateSubmodule)
          // Private submodule should go first because that means the latest
          // submodule version will be committed
          pushTargets.unshift(privateSubmodule)
        } catch (e) {
          const err = e as Error
          await vscode.window.showErrorMessage(err.message)
          return
        }
      } else {
        console.warn('Could not find private submodule')
      }
      // push content
      progress.report({ message: 'Pushing...' })
      const commitMessage = await getMessage()
      /* istanbul ignore if */
      if (commitMessage == null || !canPush(await openAndValidate(DocumentsToOpen.modified))) {
        return
      }

      for (const repo of pushTargets) {
        const infoWithRepo = async (msg: string) => {
          /* istanbul ignore next (just wrapping function) */
          return await vscode.window.showInformationMessage(`${repo.rootUri.fsPath}: ${msg}`)
        }
        const errorWithRepo = async (msg: string) => {
          /* istanbul ignore next (just wrapping function) */
          return await vscode.window.showErrorMessage(`${repo.rootUri.fsPath}: ${msg}`)
        }
        await _pushContent(repo, commitMessage, infoWithRepo, errorWithRepo)()
      }
    })
  }
}

interface GitError extends Error {
  stdout: string | null
  gitErrorCode?: string
}

export const _pushContent = (
  repo: Repository,
  commitMessage: string,
  infoReporter: (msg: string) => Thenable<string | undefined>,
  errorReporter: (msg: string) => Thenable<string | undefined>,
  options?: { branchName?: string }
) => async () => {
  const commitOptions: CommitOptions = { all: true }

  let commitSucceeded = false

  try {
    await repo.commit(commitMessage, commitOptions)
    commitSucceeded = true
  } catch (err) {
    const e = err as GitError
    /* istanbul ignore if */
    if (e.stdout == null) { throw e }
    if (e.stdout.includes('nothing to commit')) {
      void errorReporter('No changes to push.')
    } else {
      /* istanbul ignore next */
      const message: string = e.gitErrorCode ?? e.message
      void errorReporter(`Push failed: ${message}`)
    }
  }

  if (commitSucceeded) {
    const head = expect(repo.state.HEAD, 'This does not appear to be a git repository. Create one first')
    const branchName = expect(head.name, 'You do not appear to have a branch checked out. Maybe you checked out a commit or are in the middle of rebasing?')
    try {
      if (head.upstream != null) {
        await repo.pull()
        await repo.push()
      } else {
        await repo.push('origin', branchName, true)
      }
      void infoReporter('Successful content push.')
    } catch (err) {
      const e = err as GitError
      /* istanbul ignore if */
      if (e.gitErrorCode == null) { throw e }
      if (e.gitErrorCode === GitErrorCodes.Conflict) {
        void errorReporter('Content conflict, please resolve.')
      } else {
        void errorReporter(`Push failed: ${e.message}`)
      }
    }
  }
}
