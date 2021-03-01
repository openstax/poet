import { h, Fragment, render, createContext } from 'preact' // eslint-disable-line no-unused-vars
import { useState, useContext, useEffect } from 'preact/hooks'
import 'react-sortable-tree/style.css'
import SortableTree from 'react-sortable-tree'
import stringify from 'json-stable-stringify'

const vscode = acquireVsCodeApi() // eslint-disable-line no-undef
const nodeType = 'toc-element'

const getExpandedIndices = (tree) => {
  const stack = [...tree.children]
  const subcollections = []
  while (stack.length > 0) {
    const element = stack.pop()
    if (element.type === 'subcollection') {
      subcollections.push(element)
      stack.push(...element.children)
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
  const stack = [...tree.children]
  const subcollections = []
  while (stack.length > 0) {
    const element = stack.pop()
    if (element.type === 'subcollection') {
      subcollections.push(element)
      stack.push(...element.children)
    }
  }
  for (const index of indices) {
    subcollections[index].expanded = true
  }
}

const removeExpanded = (key, value) => key === 'expanded' ? undefined : value

const SearchContext = createContext({})

const saveState = (item) => {
  // vscode.postMessage({type: 'debug', item: ['save', item]})
  vscode.setState(item)
}
const getSavedState = () => {
  // vscode.postMessage({type: 'debug', item: ['load', vscode.getState()]})
  return vscode.getState()
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

  const handleChange = (newChildren) => {
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

    if (oldStructure !== newStructure) {
      vscode.postMessage({ type: 'write-tree', treeData: newData })
    }
  }

  const getNodeProps = ({ node }) => {
    const typeToColor = {
      subcollection: 'green',
      module: 'purple'
    }
    return {
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
    vscode.postMessage({ type: 'subcollection-create' })
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
              ? <button onClick={handleAddModule}>Add Module</button>
              : <></>
          }
          {
            props.canAddSubcollections
              ? <button onClick={handleAddSubcollection}>Add Subcollection</button>
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
        {trees.map((tree, i) => {
          if (selection !== i) {
            return <></>
          }
          return (
            <div key={i} style={{ height: '100%' }}>
              <SearchContext.Provider value={searchContext}>
                <ContentTree
                  modifiesStateName={modifiesStateName}
                  index={i}
                  data={tree}
                  editable={props.editable}
                />
              </SearchContext.Provider>
            </div>
          )
        })}
      </div>
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
