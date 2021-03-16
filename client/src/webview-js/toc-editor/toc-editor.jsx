import { h, Fragment, render, createContext } from 'preact' // eslint-disable-line no-unused-vars
import { useState, useContext, useEffect, useRef } from 'preact/hooks'
import 'react-sortable-tree/style.css'
import SortableTree from 'react-sortable-tree'
import stringify from 'json-stable-stringify'

const vscode = acquireVsCodeApi() // eslint-disable-line no-undef
const nodeType = 'toc-element'

const getExpandedIndices = (tree) => {
  const stack = [...tree.children.slice().reverse()]
  const subcollections = []
  while (stack.length > 0) {
    const element = stack.pop()
    if (element.type === 'subcollection') {
      subcollections.push(element)
      stack.push(...element.children.slice().reverse())
    }
  }
  const indices = []
  for (let x = 0; x < subcollections.length; x++) {
    if (subcollections[x].expanded === true) {
      indices.push(x)
    }
  }
  return indices
}

const expandIndices = (tree, indices) => {
  const stack = [...tree.children.slice().reverse()]
  const subcollections = []
  while (stack.length > 0) {
    const element = stack.pop()
    if (element.type === 'subcollection') {
      subcollections.push(element)
      stack.push(...element.children.slice().reverse())
    }
  }
  for (const index of indices) {
    subcollections[index].expanded = true
  }
}

const removeExpanded = (key, value) => key === 'expanded' ? undefined : value

const SearchContext = createContext({})

const saveState = (item) => {
  vscode.setState(item)
}
const getSavedState = () => {
  return vscode.getState()
}

// Use this function to send messages to the extension debug console
// eslint-disable-next-line no-unused-vars
const debug = (item) => {
  vscode.postMessage({ type: 'debug', item })
}

const InputOnFocus = (props) => {
  const [focus, setFocus] = useState(false)
  const [value, setValue] = useState(props.value)
  const inputRef = useRef(null)

  // be reactive to a value change up the tree
  useEffect(() => {
    setValue(props.value)
  }, [props.value])

  // focus the input box when it appears
  useEffect(() => {
    if (focus) {
      inputRef.current.focus()
    }
  }, [focus])

  const blur = (event) => {
    props.onBlur(event)
    setFocus(false)
  }

  if (focus) {
    return (
      <input
        className='node-title-rename'
        style={{ display: 'block', fontWeight: 'inherit', fontSize: 'inherit', color: 'inherit', height: 'inherit' }}
        ref={inputRef}
        onBlur={(event) => { blur(value) }}
        onChange={(event) => { setValue(event.target.value) }}
        onKeyDown={(event) => { if(event.key === 'Enter') { blur(value) } }}
        value={value}
      />
    )
  }
  return <span className='node-title' style={{ display: 'block', minWidth: '5em', height: '1em' }} onClick={() => { setFocus(true) }}>{value}</span>
}

const ContentTree = (props) => {
  const modifiesStateName = props.modifiesStateName
  const [data, setData] = useState(props.data)

  // be reactive to a data change up the tree as well
  useEffect(() => {
    setData(props.data)
  }, [props.data])

  const {
    searchQuery,
    // setSearchQuery,
    searchFocusIndex,
    setSearchFocusIndex,
    searchFoundCount,
    setSearchFoundCount
  } = useContext(SearchContext)

  const searchFinishCallback = (matches) => {
    if (searchFoundCount === matches.length) {
      // Returning prevents infinite render loop
      return
    }
    if (isNaN(searchFocusIndex) || isNaN(searchFoundCount)) {
      // This is a bug, but let's at least error gracefully
      // instead of freezing with infinite render loop
      const message = 'Divided search item by zero (probably)'
      vscode.postMessage({ type: 'error', message })
      throw new Error(message)
    }
    setSearchFoundCount(matches.length)
    setSearchFocusIndex(matches.length > 0 ? searchFocusIndex % matches.length : 0)
  }

  const searchMethod = ({ node, searchQuery }) => {
    if (!searchQuery) {
      return false
    }
    const titleMatches = node.title && node.title.toLowerCase().indexOf(searchQuery.toLowerCase()) > -1
    const subtitleMatches = node.subtitle && node.subtitle.toLowerCase().indexOf(searchQuery.toLowerCase()) > -1
    return !!(titleMatches || subtitleMatches)
  }

  const handleChange = (newChildren, force = false) => {
    const { treesData, selectionIndices } = getSavedState()

    const newData = { ...data, ...{ children: newChildren } }
    const oldStructure = stringify(data.children, { replacer: removeExpanded })
    const newStructure = stringify(newChildren, { replacer: removeExpanded })

    if (data.children.length - newChildren.length > 3) {
      // There's a bug that deletes the whole tree except for one element.
      // Prevent this by not allowing high magnitude deletions
      return
    }

    treesData[modifiesStateName][props.index].children = newChildren
    saveState({ treesData, selectionIndices })
    setData(newData)

    if (oldStructure !== newStructure || force) {
      vscode.postMessage({ type: 'write-tree', treeData: newData })
    }
  }

  const getNodeProps = ({ node }) => {
    const typeToColor = {
      subcollection: 'green',
      module: 'purple'
    }
    const typeToRenameAction = {
      // Force rewriting the tree only will change the module title as it appears in the collection file,
      // but won't change the actual title inside the module content.
      // We need to have the base part of the extension do that for us.
      module: (value) => {
        node.title = value
        vscode.postMessage({ type: 'module-rename', moduleid: node.moduleid, newName: value })
      },
      // We can change the title by just force rewriting the collection tree with the modified title
      // Subcollections don't have persistent identifiers, so changing them in the base part of the
      // extension would be tougher to do.
      subcollection: (value) => {
        node.title = value
        handleChange(data.children, true)
      }
    }

    return {
      title: <InputOnFocus onBlur={typeToRenameAction[node.type]} value={node.title} />,
      style: {
        boxShadow: `0 0 0 4px ${typeToColor[node.type]}`
      }
    }
  }

  const canDrop = ({ nextParent }) => {
    if (nextParent && nextParent.type === 'module') {
      return false
    }
    return true
  }

  return (
    <div style={{ height: '100%' }}>
      <SortableTree
        treeData={data.children}
        onChange={props.editable ? handleChange : () => {}} // non-editable treeData will never change
        generateNodeProps={getNodeProps}
        canDrop={props.editable ? canDrop : () => true} // Dropping item into non-editable trees will destroy the item
        shouldCopyOnOutsideDrop={!props.editable}
        dndType={nodeType}
        searchQuery={searchQuery}
        searchFocusOffset={searchFocusIndex}
        searchFinishCallback={searchFinishCallback}
        searchMethod={searchMethod}
      />
    </div>
  )
}

const EditorPanel = (props) => {
  const modifiesStateName = props.modifiesStateName
  const trees = props.treesData
  const [selection, setSelection] = useState(props.selectionIndex)

  const selectedTree = trees[selection]

  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocusIndex, setSearchFocusIndex] = useState(0)
  const [searchFoundCount, setSearchFoundCount] = useState(0)

  const selectPrevMatch = () => {
    if (searchFoundCount === 0) { return }
    setSearchFocusIndex((searchFocusIndex + searchFoundCount - 1) % searchFoundCount)
  }

  const selectNextMatch = () => {
    if (searchFoundCount === 0) { return }
    setSearchFocusIndex((searchFocusIndex + searchFoundCount + 1) % searchFoundCount)
  }

  const handleAddModule = (event) => {
    vscode.postMessage({ type: 'module-create' })
  }

  const handleAddSubcollection = (event) => {
    vscode.postMessage({ type: 'subcollection-create', slug: selectedTree.slug })
  }

  const handleSelect = (event) => {
    const { treesData, selectionIndices } = getSavedState()
    const newSelection = parseInt(event.target.value)
    selectionIndices[modifiesStateName] = newSelection
    saveState({ treesData, selectionIndices })
    setSelection(newSelection)
  }

  const handleSearch = (event) => {
    setSearchQuery(event.target.value)
  }

  const searchContext = {
    searchQuery,
    setSearchQuery,
    searchFocusIndex,
    setSearchFocusIndex,
    searchFoundCount,
    setSearchFoundCount
  }

  const searchInfo = `${searchFoundCount > 0 ? searchFocusIndex + 1 : 0} / ${searchFoundCount}`

  return (
    <div className={`panel-${modifiesStateName}`} style={{ display: 'flex', flexDirection: 'column', height: '99vh', width: '49vw' }}>
      {
        selectedTree == null
          ? <p>No data</p>
          : <>
            <div className="controls" style={{ margin: '1rem' }}>
              <select
                className='tree-select'
                value={selection}
                style={{ maxWidth: '300px' }}
                onChange={handleSelect}
              >
                {trees.map((tree, i) => <option key={i} value={i}>{tree.title}</option>)}
              </select>
              <div style={{ display: 'flex' }}>
                {
                  props.canAddModules
                    ? <button className='module-create' onClick={handleAddModule}>Add Module</button>
                    : <></>
                }
                {
                  props.canAddSubcollections
                    ? <button className='subcollection-create' onClick={handleAddSubcollection}>Add Subcollection</button>
                    : <></>
                }
              </div>
              <div style={{ marginTop: '0', height: '2rem', display: 'flex', maxWidth: '400px', alignItems: 'center' }}>
                <input
                  className='search'
                  style={{ maxWidth: '300px', height: '100%', padding: '0', paddingLeft: '4px' }}
                  placeholder={'Search...'}
                  onChange={handleSearch}
                />
                <button
                  className='search-prev'
                  style={{ height: '100%' }}
                  disabled={!searchFoundCount}
                  onClick={selectPrevMatch}
                >
                  {'<'}
                </button>
                <button
                  className='search-next'
                  style={{ height: '100%' }}
                  disabled={!searchFoundCount}
                  onClick={selectNextMatch}
                >
                  {'>'}
                </button>
                {
                  searchQuery
                    ? <p className='search-info' style={{ margin: '0px 10px', fontWeight: 'bold' }}>{searchInfo}</p>
                    : <></>
                }
              </div>
            </div>
            <div style={{ flexGrow: '1' }}>
              <div style={{ height: '100%' }}>
                <SearchContext.Provider value={searchContext}>
                  <ContentTree
                    modifiesStateName={modifiesStateName}
                    index={selection}
                    key={selection}
                    data={selectedTree}
                    editable={props.editable}
                  />
                </SearchContext.Provider>
              </div>
            </div>
          </>
      }
    </div>
  )
}

const App = (props) => (
  <div data-app-init='true' style={{ display: 'flex', justifyContent: 'space-between' }}>
    <EditorPanel
      modifiesStateName={'editable'}
      treesData={props.treesData.editable}
      selectionIndex={props.selectionIndices.editable}
      editable={true}
      canAddSubcollections
    />
    <EditorPanel
      modifiesStateName={'uneditable'}
      treesData={props.treesData.uneditable}
      selectionIndex={props.selectionIndices.uneditable}
      editable={false}
      canAddModules
    />
  </div>
)

window.addEventListener('load', () => {
  vscode.postMessage({ type: 'refresh' })
})

window.addEventListener('message', event => {
  const previousState = getSavedState()
  const oldData = previousState?.treesData
  const newData = event.data
  if (oldData != null) {
    const slugToExpandedIndices = {}
    for (const tree of oldData.editable) {
      slugToExpandedIndices[tree.slug] = getExpandedIndices(tree)
    }
    for (const tree of newData.editable) {
      const expandedIndices = slugToExpandedIndices[tree.slug]
      if (expandedIndices != null) {
        expandIndices(tree, expandedIndices)
      }
    }
  }
  const selectionIndices = previousState ? previousState.selectionIndices : { editable: 0, uneditable: 0 }
  const appRootElement = window.document.querySelector('[data-app-init]')
  if (appRootElement != null) {
    appRootElement.removeAttribute('data-render-cached')
  }
  if (stringify(oldData) === stringify(newData) && appRootElement != null) {
    // no need to re-render
    appRootElement.setAttribute('data-render-cached', true)
    return
  }
  saveState({ treesData: newData, selectionIndices })
  renderApp()
})

function renderApp() {
  const previousState = getSavedState()
  const treesData = previousState ? previousState.treesData : { editable: [], uneditable: [] }
  const selectionIndices = previousState ? previousState.selectionIndices : { editable: 0, uneditable: 0 }
  const mountPoint = document.getElementById('app')
  render(<App {...{ treesData, selectionIndices }}/>, mountPoint)
}
