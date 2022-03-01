import vscode from 'vscode'
import { expect, getErrorDiagnosticsBySource, getRootPathUri } from './utils'
import { GitExtension, GitErrorCodes, CommitOptions, Repository, RefType, Ref } from './git-api/git'
import { ExtensionHostContext } from './panel'
import { DiagnosticSource, requestEnsureIds } from '../../common/src/requests'

export enum Tag {
  release = 'Release',
  candidate = 'Release Candidate'
}

export enum DocumentsToOpen {
  all = 'All Content',
  modified = 'Modified Content'
}

export const PushValidationModal = {
  cnxmlErrorMsg: 'There are outstanding validation errors that must be resolved before pushing is allowed.',
  xmlErrorMsg: 'There are outstanding schema errors that must be resolved before pushing is allowed.'
}

export const getOpenDocuments = async (): Promise<Set<string>> => {
  // People have asked for this for 6 years! https://github.com/Microsoft/vscode/issues/15178
  const ret = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, cancellable: true },
    async (progress, token) => {
      progress.report({ message: 'Discovering open documents...' })
      const openDocuments: Set<string> = new Set()
      if (vscode.window.activeTextEditor !== undefined) {
        const start = vscode.window.activeTextEditor.document.uri.toString()
        let activeTextEditor: vscode.TextEditor | undefined
        // Potential for infinite loop if someone closes the editor they started on
        while (!openDocuments.has(start)) {
          if (token.isCancellationRequested) {
            return undefined
          }
          await vscode.commands.executeCommand('workbench.action.nextEditor')
          activeTextEditor = vscode.window.activeTextEditor
          if (activeTextEditor !== undefined) {
            openDocuments.add(vscode.window.activeTextEditor.document.uri.toString())
          }
        }
      }
      return openDocuments
    }
  )
  if (ret === undefined) throw new Error('Canceled')
  return ret
}

export const getDocumentsToOpen = async (
  checkType: DocumentsToOpen,
  openDocuments: Set<string>
): Promise<Set<string>> => {
  const documentsToOpen: Set<string> = new Set()
  let urisToAdd: string[] = []
  if (checkType === DocumentsToOpen.modified) {
    const repo = getRepo()
    urisToAdd = (await repo.diffWithHEAD()).map(change => change.uri.toString())
  } else if (checkType === DocumentsToOpen.all) {
    // TODO: Consider using extension host context here to get the modules instead of glob
    urisToAdd = (await vscode.workspace.findFiles('**/*.cnxml')).map(uri => uri.toString())
  }
  for (const uri of urisToAdd) {
    if (!openDocuments.has(uri)) {
      documentsToOpen.add(uri)
    }
  }
  return documentsToOpen
}

export const closeValidDocuments = async (
  openedEditors: vscode.TextEditor[],
  errorsBySource: Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>
) => {
  const urisWithErrors: Set<string> = new Set()
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
          progress.report({ message: message })
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
  const openDocuments = await getOpenDocuments()
  const documentsToOpen = await getDocumentsToOpen(checkType, openDocuments)
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

export const canPush = async (errorsBySource: Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>): Promise<boolean> => {
  if (errorsBySource.has(DiagnosticSource.cnxml)) {
    void vscode.window.showErrorMessage(PushValidationModal.cnxmlErrorMsg, { modal: true })
    return false
  }
  if (errorsBySource.has(DiagnosticSource.xml)) {
    await vscode.window.showErrorMessage(PushValidationModal.xmlErrorMsg, { modal: true })
    return false
  }
  return true
}

export const getRepo = (): Repository => {
  const gitExtension = expect(vscode.extensions.getExtension<GitExtension>('vscode.git'), 'Expected vscode.git extension to be installed').exports
  const api = gitExtension.getAPI(1)
  const result: Repository = api.repositories[0]
  return result
}

export const taggingDialog = async (): Promise<Tag | undefined> => {
  const tagMode = await vscode.window.showInformationMessage(
    'Tag for release candidate or release?',
    { modal: true },
    ...[Tag.release, Tag.candidate]
  )

  if (tagMode === undefined) { return undefined }
  return tagMode
}

export const getNewTag = async (repo: Repository, tagMode: Tag, head: Ref): Promise<string | undefined> => {
  const tags: number[] = []
  const release = tagMode === Tag.release
  const regex = release ? /^\d+$/ : /^\d+rc$/

  const validTags = repo.state.refs.filter((ref, i) => {
    return (ref.type === RefType.Tag && regex.test(ref.name as string))
  })

  for (const ref of validTags) {
    if (ref.commit === head.commit) {
      void vscode.window.showErrorMessage('Tag of this type already exists for this content version.', { modal: false })
      return undefined
    }

    const versionNumberString = expect(ref.name, '').replace('rc', '')
    tags.push(Number(versionNumberString))
  }

  const previousVersion = tags.length > 0 ? Math.max(...tags) : 0
  return `${previousVersion + 1}${release ? '' : 'rc'}`
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

export const pushContent = (hostContext: ExtensionHostContext) => async () => {
  const errorsBySource = await openAndValidate(DocumentsToOpen.modified)
  if (await canPush(errorsBySource)) {
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
      // fix ids
      // TODO: better ui in future. Add `increment` value in `progress.report` and use a callback to update real progress
      await requestEnsureIds(hostContext.client, { workspaceUri: uri.toString() })
      // push content
      progress.report({ message: 'Pushing...' })
      await _pushContent(getRepo, getMessage, vscode.window.showInformationMessage, vscode.window.showErrorMessage)()
    })
  }
}

interface GitError extends Error {
  stdout: string | null
  gitErrorCode?: string
}

export const _pushContent = (
  _getRepo: () => Repository,
  _getMessage: () => Thenable<string | undefined>,
  infoReporter: (msg: string) => Thenable<string | undefined>,
  errorReporter: (msg: string) => Thenable<string | undefined>
) => async () => {
  const repo = _getRepo()
  const commitOptions: CommitOptions = { all: true }

  let commitSucceeded = false

  const commitMessage = await _getMessage()
  /* istanbul ignore if */
  if (commitMessage == null) { return }
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
      const message: string = e.gitErrorCode === undefined ? e.message : /* istanbul ignore next */ e.gitErrorCode
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

export const tagContent = async (): Promise<void> => {
  const repo = getRepo()
  const head = expect(repo.state.HEAD, 'This does not appear to be a git repository. Create one first')
  expect(head.name, 'You do not appear to have a branch checked out. Maybe you checked out a commit or are in the middle of rebasing?')
  await repo.fetch()

  if ((await repo.diffWithHEAD()).length > 0) {
    void vscode.window.showErrorMessage('Can\'t tag. Local unpushed changes exist', { modal: false })
    return
  }

  const tagging = await taggingDialog()
  /* istanbul ignore if */
  if (tagging === undefined) { return }

  const tag = await getNewTag(repo, tagging, head)

  if (tag === undefined) { return }

  try {
    await (repo as any)._repository.tag(tag) // when VSCode API is updated -> await repo.tag(tag)
  } catch (err) {
    const e = err as GitError
    const message: string = e.gitErrorCode === undefined ? e.message : /* istanbul ignore next */ e.gitErrorCode
    void vscode.window.showErrorMessage(`Tagging failed: ${message}`, { modal: false }) // ${String(e.stderr)}
    return
  }

  // push
  try {
    await repo.push('origin', tag)
    void vscode.window.showInformationMessage(`Successful tag for ${tagging}.`, { modal: false })
  } catch (err) {
    const e = err as GitError
    const message: string = e.gitErrorCode === undefined ? e.message : /* istanbul ignore next */ e.gitErrorCode
    void vscode.window.showErrorMessage(`Push failed: ${message}`, { modal: false })
  }
}
