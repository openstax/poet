declare let acquireVsCodeApi: any
let vscode: any

interface PendingEntry {
  mediaName: string
  data: string | ArrayBuffer | null
}
let pending: PendingEntry[] = []

window.addEventListener('load', () => {
  vscode = acquireVsCodeApi() // eslint-disable-line no-undef

  const dropArea = document.getElementById('drop-area') as HTMLElement
  const preview = document.getElementById('preview') as HTMLElement
  const uploadButton = document.getElementById('trigger-upload') as HTMLElement
  const cancelButton = document.getElementById('cancel-upload') as HTMLElement

  const clearPending = (): void => {
    pending = []
    if (preview.firstChild !== null) {
      while (preview.firstChild) { // eslint-disable-line @typescript-eslint/strict-boolean-expressions
        preview.firstChild.remove()
      }
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
        data: reader.result
      })
    }
  }

  const handleDrop = (e: DragEvent): void => {
    const files = e.dataTransfer?.files

    if (files) { // eslint-disable-line @typescript-eslint/strict-boolean-expressions
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
