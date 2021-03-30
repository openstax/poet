declare let acquireVsCodeApi: any;
let vscode: any
let pending: { mediaName: any; data: string | ArrayBuffer | null }[] = []

window.addEventListener('load', () => {
  vscode = acquireVsCodeApi() // eslint-disable-line no-undef

  const dropArea = document.getElementById('drop-area') as HTMLElement
  const preview = document.getElementById('preview') as HTMLElement
  const uploadButton = document.getElementById('trigger-upload') as HTMLElement
  const cancelButton = document.getElementById('cancel-upload') as HTMLElement

  const clearPending = () => {
    pending = []
    while (preview.firstChild) {
      preview.firstChild.remove()
    }
  }

  const preventDefaults = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  };

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, preventDefaults, false)
  })

  const previewFile = (file: File) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onloadend = function () {
      const container = document.createElement('div')
      const name = document.createElement('p')
      name.textContent = file.name
      const img = document.createElement('img') as HTMLImageElement
      img.src = reader.result as string;
      container.appendChild(name)
      container.appendChild(img)
      preview.appendChild(container)

      pending.push({
        mediaName: file.name,
        data: reader.result
      })
    }
  }

  const handleDrop = (e: DragEvent) => {
    const files = e.dataTransfer?.files;

    if (files) {
      ([...files]).forEach(previewFile)
    }
  }

  const handleUpload = (e: Event) => {
    e.preventDefault()
    vscode.postMessage({
      mediaUploads: pending
    })
    clearPending()
  }

  const handleCancel = (e: Event) => {
    e.preventDefault()
    clearPending()
  }

  dropArea.addEventListener('drop', handleDrop, false)
  uploadButton.addEventListener('click', handleUpload, false)
  cancelButton.addEventListener('click', handleCancel, false)

  dropArea.setAttribute('data-app-init', 'true')
})
