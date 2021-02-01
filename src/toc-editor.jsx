import { h, Fragment, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import 'react-sortable-tree/style.css';
import './toc-dark.css';
import SortableTree from 'react-sortable-tree';

let isLoaded = false;
const vscode = acquireVsCodeApi();
const nodeType = 'toc-element'

const removeExpanded = (obj) => {
  if (typeof obj !== 'object') {
    return obj
  }
  if (obj instanceof Array) {
    const copy = []
    for (const subobj of obj) {
      copy.push(removeExpanded(subobj))
    }
    return copy
  }
  const { expanded, ...copy } = obj
  copy.children = removeExpanded(copy.children)
  return copy
}

const ContentTree = (props) => {
  const modifiesStateName = props.modifiesStateName
  const [data, setData] = useState(props.data);

  const handleChange = (newChildren) => {
    const { treesData, selectionIndices } = vscode.getState()

    const newData = { ...data, ...{children: newChildren} }
    const oldStructure = JSON.stringify(removeExpanded(data.children))
    const newStructure = JSON.stringify(removeExpanded(newChildren))

    if (data.children.length - newChildren.length > 3) {
      // There's a bug that deletes the whole tree except for one element.
      // Prevent this by not allowing high magnitude deletions
      return
    }

    treesData[modifiesStateName][props.index].children = newChildren
    vscode.setState({ treesData, selectionIndices })
    setData(newData)

    if (oldStructure !== newStructure) {
      vscode.postMessage({treeData: newData})
    }
  }

  const getNodeProps = ({ node }) => {
    const typeToColor = {
      'subcollection': 'green',
      'module': 'purple'
    }
    return {
      style: {
        boxShadow: `0 0 0 4px ${typeToColor[node.type]}`,
      },
      title: node.title + (node.moduleid ? ` (${node.moduleid})` : '')
    }
  }

  const canDrop = ({ nextParent}) => {
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
      />
    </div>
  )
}

const EditorPanel = (props) => {
  const modifiesStateName = props.modifiesStateName
  const trees = props.treesData
  const [selection, setSelection] = useState(props.selectionIndex);

  const handleSelect = (event) => {
    const { treesData, selectionIndices } = vscode.getState()
    const newSelection = parseInt(event.target.value)
    selectionIndices[modifiesStateName] = newSelection
    vscode.setState({ treesData, selectionIndices })
    setSelection(newSelection)
  }

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '99vh', width: '49vw'}}>
      <select value={selection} style={{margin: '1rem', maxWidth: '300px'}} onChange={handleSelect}>
        {trees.map((tree, i) => {
          return (<option key={i} value={i}>{tree.title}</option>)
        })}
      </select>
      <div style={{flexGrow: '1'}}>
        {trees.map((tree, i) => {
          return (
            <div key={i} style={{height: '100%', display: selection === i ? 'block' : 'none'}}>
              <ContentTree modifiesStateName={modifiesStateName} index={i} data={tree} editable={props.editable}/>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const App = (props) => {
  return (
    <div style={{display: 'flex', justifyContent: 'space-between'}}>
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
}

window.addEventListener('load', () => {
  isLoaded = true
  renderApp()
});

window.addEventListener('message', event => {
  const previousState = vscode.getState();
  const selectionIndices = previousState ? previousState.selectionIndices : {editable: 0, uneditable: 0}
  vscode.setState({ treesData: event.data, selectionIndices })
	if (isLoaded) {
		renderApp()
	}
});

function renderApp() {
  const previousState = vscode.getState();
  const treesData = previousState ? previousState.treesData : {editable: [], uneditable: []}
  const selectionIndices = previousState ? previousState.selectionIndices : {editable: 0, uneditable: 0}
  const mountPoint = document.getElementById('app')
  render(<App {...{treesData, selectionIndices}}/>, mountPoint);
}