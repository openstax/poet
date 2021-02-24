import { h, Fragment, render, createContext } from 'preact' // eslint-disable-line no-unused-vars
import { useState, useContext } from 'preact/hooks'
import 'react-sortable-tree/style.css'
import SortableTree from 'react-sortable-tree'
import stringify from 'json-stable-stringify'

const vscode = acquireVsCodeApi() // eslint-disable-line no-undef
const nodeType = 'toc-element'

const removeExpanded = (key, value) => key === 'expanded' ? undefined : value

const SearchContext = createContext({})

const ContentTree = (props) => {
  const modifiesStateName = props.modifiesStateName
  const [data, setData] = useState(props.data)
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
      vscode.postMessage({ signal: { type: 'error', message } })
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
    const { treesData, selectionIndices } = vscode.getState()

    const newData = { ...data, ...{ children: newChildren } }
    const oldStructure = stringify(data.children, { replacer: removeExpanded })
    const newStructure = stringify(newChildren, { replacer: removeExpanded })

    if (data.children.length - newChildren.length > 3) {
      // There's a bug that deletes the whole tree except for one element.
      // Prevent this by not allowing high magnitude deletions
      return
    }

    treesData[modifiesStateName][props.index].children = newChildren
    vscode.setState({ treesData, selectionIndices })
    setData(newData)

    if (oldStructure !== newStructure) {
      vscode.postMessage({ treeData: newData })
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

  const handleSelect = (event) => {
    const { treesData, selectionIndices } = vscode.getState()
    const newSelection = parseInt(event.target.value)
    selectionIndices[modifiesStateName] = newSelection
    vscode.setState({ treesData, selectionIndices })
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
      <div>
        <select
          className='tree-select'
          value={selection}
          style={{ margin: '1rem', maxWidth: '300px' }}
          onChange={handleSelect}
        >
          {trees.map((tree, i) => <option key={i} value={i}>{tree.title}</option>)}
        </select>
        <div style={{ margin: '1rem', marginTop: '0', height: '2rem', display: 'flex', maxWidth: '400px', alignItems: 'center' }}>
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
    />
  </div>
)

window.addEventListener('load', () => {
  vscode.postMessage({ signal: { type: 'loaded' } })
})

window.addEventListener('message', event => {
  const previousState = vscode.getState()
  const selectionIndices = previousState ? previousState.selectionIndices : { editable: 0, uneditable: 0 }
  vscode.setState({ treesData: event.data, selectionIndices })
  renderApp()
})

function renderApp() {
  const previousState = vscode.getState()
  const treesData = previousState ? previousState.treesData : { editable: [], uneditable: [] }
  const selectionIndices = previousState ? previousState.selectionIndices : { editable: 0, uneditable: 0 }
  const mountPoint = document.getElementById('app')
  render(<App {...{ treesData, selectionIndices }}/>, mountPoint)
}
