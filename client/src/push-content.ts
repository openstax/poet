import vscode from 'vscode'
import { expect, getErrorDiagnosticsBySource, getRootPathUri } from './utils'
import { GitExtension, GitErrorCodes, CommitOptions, Repository, RefType, Ref } from './git-api/git'
import { ExtensionHostContext } from './panel'
import { requestEnsureIds } from '../../common/src/requests'

export enum Tag {
  release = 'Release',
  candidate = 'Release Candidate'
}

export enum DiagnosticSource {
  xml = 'xml',
  cnxml = 'cnxml'
}

export const PushValidationModal = {
  cnxmlErrorMsg: 'There are outstanding validation errors that must be resolved before pushing is allowed.',
  xmlErrorMsg: 'There are outstanding schema errors. Are you sure you want to push these changes?',
  xmlErrorIgnoreItem: 'Yes, I know more than you'
}

export const canPush = async (errorsBySource: Map<string, Array<[vscode.Uri, vscode.Diagnostic]>>): Promise<boolean> => {
  if (errorsBySource.has(DiagnosticSource.cnxml)) {
    void vscode.window.showErrorMessage(PushValidationModal.cnxmlErrorMsg, { modal: true })
    return false
  }
  if (errorsBySource.has(DiagnosticSource.xml)) {
    const selectedItem = await vscode.window.showErrorMessage(PushValidationModal.xmlErrorMsg, { modal: true }, PushValidationModal.xmlErrorIgnoreItem)
    return selectedItem === PushValidationModal.xmlErrorIgnoreItem
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
  return tagMode as Tag
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
  if (await canPush(getErrorDiagnosticsBySource())) {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Push Content',
      cancellable: true
    }, async (progress, token) => {
      token.onCancellationRequested(() => {
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
      // await _pushContent(getRepo, getMessage, vscode.window.showInformationMessage, vscode.window.showErrorMessage)()
    })
  }
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
  if (commitMessage == null) { return }
  try {
    await repo.commit(commitMessage, commitOptions)
    commitSucceeded = true
  } catch (e) {
    if (e.stdout == null) { throw e }
    if ((e.stdout as string).includes('nothing to commit')) {
      void errorReporter('No changes to push.')
    } else {
      const message: string = e.gitErrorCode === undefined ? e.message : e.gitErrorCode
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
    } catch (e) {
      if (e.gitErrorCode == null) { throw e }
      if (e.gitErrorCode === GitErrorCodes.Conflict) {
        void errorReporter('Content conflict, please resolve.')
      } else {
        void errorReporter(`Push failed: ${e.message as string}`)
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

  if (tagging === undefined) { return }

  const tag = await getNewTag(repo, tagging, head)

  if (tag === undefined) { return }

  try {
    await (repo as any)._repository.tag(tag) // when VSCode API is updated -> await repo.tag(tag)
  } catch (e) {
    const message: string = e.gitErrorCode === undefined ? e.message : e.gitErrorCode
    void vscode.window.showErrorMessage(`Tagging failed: ${message}`, { modal: false }) // ${String(e.stderr)}
    return
  }

  // push
  try {
    await repo.push('origin', tag)
    void vscode.window.showInformationMessage(`Successful tag for ${tagging}.`, { modal: false })
  } catch (e) {
    const message: string = e.gitErrorCode === undefined ? e.message : e.gitErrorCode
    void vscode.window.showErrorMessage(`Push failed: ${message}`, { modal: false })
  }
}
