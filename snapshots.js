module.exports = {
  "__version": "6.5.0",
  "toc-editor Webview Tests": {
    "drag-n-drop": {
      "allows dnd from uneditable to editable": {
        "1": [
          {
            "type": "TOC_MOVE",
            "event": {
              "newChildIndex": 0,
              "bookIndex": 0,
              "newToc": [
                {
                  "type": "subcollection",
                  "title": "subcollection",
                  "expanded": true,
                  "children": [
                    {
                      "type": "module",
                      "moduleid": "m00003",
                      "subtitle": "m00003",
                      "title": "Module 3"
                    },
                    {
                      "type": "module",
                      "moduleid": "m00001",
                      "subtitle": "m00001",
                      "title": "Introduction"
                    }
                  ]
                },
                {
                  "type": "module",
                  "moduleid": "m00002",
                  "subtitle": "m00002",
                  "title": "Appendix"
                }
              ]
            }
          }
        ]
      },
      "allows dnd from editable to editable": {
        "1": []
      }
    }
  }
}
