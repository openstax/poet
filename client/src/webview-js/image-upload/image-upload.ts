/**
 * Asserts a value of a nullable type is not null and returns the same value with a non-nullable type
 */
function expect<T>(value: T | null | undefined, message: string): T {
  /* istanbul ignore if */
  if (value == null) {
    throw new Error(message)
  }
  return value
}

declare let acquireVsCodeApi: any
let vscode: any

interface PendingEntry {
  mediaName: string
  data: string
}
let pending: PendingEntry[] = []

window.addEventListener('load', () => {
  vscode = acquireVsCodeApi() // eslint-disable-line no-undef

  const dropArea = expect(document.getElementById('drop-area'), 'html file must contain #drop-area')
  const preview = expect(document.getElementById('preview'), 'html file must contain #preview')
  const uploadButton = expect(document.getElementById('trigger-upload'), 'html file must contain #trigger-upload')
  const cancelButton = expect(document.getElementById('cancel-upload'), 'html file must contain #cancel-upload')

  const clearPending = (): void => {
    pending = []
    while (preview.firstChild != null) {
      preview.firstChild.remove()
    }
  }

  const preventDefaults = (e: Event): void => {
    e.preventDefault()
    e.stopPropagation()
  };

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, preventDefaults, false)
  })

  const previewFile = (file: File): void => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onloadend = function () {
      const container = document.createElement('div')
      const name = document.createElement('p')
      name.textContent = file.name
      const img = document.createElement('img')
      img.src = reader.result as string
      container.appendChild(name)
      container.appendChild(img)
      preview.appendChild(container)

      pending.push({
        mediaName: file.name,
        data: reader.result as string
      })
    }
  }

  const handleDrop = (e: DragEvent): void => {
    /* istanbul ignore next */
    const files = e.dataTransfer?.files

    /* istanbul ignore else */
    if (files != null) {
      ([...files]).forEach(previewFile)
    }
  }

  const handleUpload = (e: Event): void => {
    e.preventDefault()
    vscode.postMessage({
      mediaUploads: pending
    })
    clearPending()
  }

  const handleCancel = (e: Event): void => {
    e.preventDefault()
    clearPending()
  }

  dropArea.addEventListener('drop', handleDrop, false)
  uploadButton.addEventListener('click', handleUpload, false)
  cancelButton.addEventListener('click', handleCancel, false)

  dropArea.setAttribute('data-app-init', 'true')
})
