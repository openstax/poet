module.exports = {
  "__version": "6.5.0",
  "toc-editor Webview Tests": {
    "drag-n-drop": {
      "allows dnd from uneditable to editable": {
        "1": [
          {
            "type": "TOC_MOVE",
            "event": {
              "nodeToken": "page-token-m00003",
              "newParentToken": "subbook-token-subcollection",
              "newChildIndex": 0,
              "bookIndex": 0,
              "newToc": [
                {
                  "type": "TocNodeKind.Inner",
                  "title": "subcollection",
                  "token": "subbook-token-subcollection",
                  "expanded": true,
                  "children": [
                    {
                      "type": "TocNodeKind.Leaf",
                      "token": "page-token-m00003",
                      "moduleid": "m00003",
                      "subtitle": "m00003",
                      "title": "Module 3"
                    },
                    {
                      "type": "TocNodeKind.Leaf",
                      "token": "page-token-m00001",
                      "moduleid": "m00001",
                      "subtitle": "m00001",
                      "title": "Introduction"
                    }
                  ]
                },
                {
                  "type": "TocNodeKind.Leaf",
                  "token": "page-token-m00002",
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
        "1": [
          {
            "type": "TOC_MOVE",
            "event": {
              "nodeToken": "page-token-m00002",
              "newParentToken": "subbook-token-subcollection",
              "newChildIndex": 0,
              "bookIndex": 0,
              "newToc": [
                {
                  "type": "TocNodeKind.Inner",
                  "title": "subcollection",
                  "token": "subbook-token-subcollection",
                  "expanded": true,
                  "children": [
                    {
                      "type": "TocNodeKind.Leaf",
                      "token": "page-token-m00002",
                      "moduleid": "m00002",
                      "subtitle": "m00002",
                      "title": "Appendix"
                    },
                    {
                      "type": "TocNodeKind.Leaf",
                      "token": "page-token-m00001",
                      "moduleid": "m00001",
                      "subtitle": "m00001",
                      "title": "Introduction"
                    }
                  ]
                }
              ]
            }
          }
        ]
      },
      "deletes elements when dnd from editable to uneditable": {
        "1": [
          {
            "type": "TOC_REMOVE",
            "event": {
              "nodeToken": "page-token-m00002",
              "bookIndex": 0,
              "newToc": [
                {
                  "type": "TocNodeKind.Inner",
                  "title": "subcollection",
                  "token": "subbook-token-subcollection",
                  "expanded": true,
                  "children": [
                    {
                      "type": "TocNodeKind.Leaf",
                      "token": "page-token-m00001",
                      "moduleid": "m00001",
                      "subtitle": "m00001",
                      "title": "Introduction"
                    }
                  ]
                }
              ]
            }
          }
        ]
      }
    },
    "controls": {
      "can tell the extension to create Page": {
        "1": [
          {
            "type": "PAGE_CREATE",
            "bookIndex": 0
          }
        ]
      },
      "can tell the extension to create Subbook": {
        "1": [
          {
            "type": "SUBBOOK_CREATE",
            "slug": "test",
            "bookIndex": 0
          },
          {
            "type": "SUBBOOK_CREATE",
            "slug": "test-2",
            "bookIndex": 0
          }
        ]
      },
      "can tell the extension to rename Page": {
        "1": [
          {
            "type": "PAGE_RENAME",
            "event": {
              "newTitle": "Introductionabc",
              "nodeToken": "page-token-m00001",
              "node": {
                "type": "TocNodeKind.Leaf",
                "token": "page-token-m00001",
                "moduleid": "m00001",
                "subtitle": "m00001",
                "title": "Introductionabc"
              },
              "bookIndex": 0,
              "newToc": [
                {
                  "type": "TocNodeKind.Inner",
                  "title": "subcollection",
                  "token": "subbook-token-subcollection",
                  "expanded": true,
                  "children": [
                    {
                      "type": "TocNodeKind.Leaf",
                      "token": "page-token-m00001",
                      "moduleid": "m00001",
                      "subtitle": "m00001",
                      "title": "Introductionabc"
                    },
                    {
                      "type": "TocNodeKind.Leaf",
                      "token": "page-token-m00002",
                      "moduleid": "m00002",
                      "subtitle": "m00002",
                      "title": "Appending To Lists"
                    }
                  ]
                },
                {
                  "type": "TocNodeKind.Leaf",
                  "token": "page-token-m00003",
                  "moduleid": "m00003",
                  "subtitle": "m00003",
                  "title": "Appendix"
                }
              ]
            }
          }
        ]
      },
      "can tell the extension to rename Subbook": {
        "1": [
          {
            "type": "SUBBOOK_RENAME",
            "event": {
              "newTitle": "subcollectionabc",
              "nodeToken": "subbook-token-subcollection",
              "node": {
                "type": "TocNodeKind.Inner",
                "title": "subcollectionabc",
                "token": "subbook-token-subcollection",
                "expanded": true,
                "children": [
                  {
                    "type": "TocNodeKind.Leaf",
                    "token": "page-token-m00001",
                    "moduleid": "m00001",
                    "subtitle": "m00001",
                    "title": "Introduction"
                  },
                  {
                    "type": "TocNodeKind.Leaf",
                    "token": "page-token-m00002",
                    "moduleid": "m00002",
                    "subtitle": "m00002",
                    "title": "Appending To Lists"
                  }
                ]
              },
              "bookIndex": 0,
              "newToc": [
                {
                  "type": "TocNodeKind.Inner",
                  "title": "subcollectionabc",
                  "token": "subbook-token-subcollection",
                  "expanded": true,
                  "children": [
                    {
                      "type": "TocNodeKind.Leaf",
                      "token": "page-token-m00001",
                      "moduleid": "m00001",
                      "subtitle": "m00001",
                      "title": "Introduction"
                    },
                    {
                      "type": "TocNodeKind.Leaf",
                      "token": "page-token-m00002",
                      "moduleid": "m00002",
                      "subtitle": "m00002",
                      "title": "Appending To Lists"
                    }
                  ]
                },
                {
                  "type": "TocNodeKind.Leaf",
                  "token": "page-token-m00003",
                  "moduleid": "m00003",
                  "subtitle": "m00003",
                  "title": "Appendix"
                }
              ]
            }
          }
        ]
      }
    }
  }
}
