let vscode
let pending = []

window.addEventListener('load', () => {
  vscode = acquireVsCodeApi() // eslint-disable-line no-undef

  const dropArea = document.getElementById('drop-area')
  const preview = document.getElementById('preview')
  const uploadButton = document.getElementById('trigger-upload')
  const cancelButton = document.getElementById('cancel-upload')

  const clearPending = () => {
    pending = []
    while (preview.firstChild) {
      preview.firstChild.remove()
    }
  }

  const preventDefaults = (e) => {
    e.preventDefault()
    e.stopPropagation()
  };

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, preventDefaults, false)
  })

  const previewFile = (file) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onloadend = function () {
      const container = document.createElement('div')
      const name = document.createElement('p')
      name.textContent = file.name
      const img = document.createElement('img')
      img.src = reader.result
      container.appendChild(name)
      container.appendChild(img)
      preview.appendChild(container)

      pending.push({
        mediaName: file.name,
        data: reader.result
      })
    }
  }

  const handleDrop = (e) => {
    const files = e.dataTransfer.files;

    ([...files]).forEach(previewFile)
  }

  const handleUpload = (e) => {
    e.preventDefault()
    vscode.postMessage({
      mediaUploads: pending
    })
    clearPending()
  }

  const handleCancel = (e) => {
    e.preventDefault()
    clearPending()
  }

  dropArea.addEventListener('drop', handleDrop, false)
  uploadButton.addEventListener('click', handleUpload, false)
  cancelButton.addEventListener('click', handleCancel, false)
})
