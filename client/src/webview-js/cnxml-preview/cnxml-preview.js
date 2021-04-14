let vscode

let preview
let sendButton
let textarea

const MATH_WRAPPER_TAGNAME = 'mathwrapper'

// YANK THESE TYPES https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/preview-src/scroll-sync.ts

const getElementBoundsOfInfluence = ({ element }) => {
  const myBounds = element.getBoundingClientRect()

  // Some code line elements may contain other code line elements.
  // In those cases, only take the height up to that child.
  const codeLineChild = element.querySelector('[data-line]')
  if (codeLineChild) {
    const childBounds = codeLineChild.getBoundingClientRect()
    const height = Math.max(1, (childBounds.top - myBounds.top))
    return {
      top: myBounds.top,
      height: height
    }
  }
  return {
    top: myBounds.top,
    height: Math.max(1, myBounds.height)
  }
}

const getLineElementsAtPageOffset = (offset) => {
  const lines = sourceLineElements()
  const position = offset - window.scrollY
  let lo = -1
  let hi = lines.length - 1
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const bounds = getElementBoundsOfInfluence(lines[mid])
    if (bounds.top + bounds.height >= position) {
      hi = mid
    } else {
      lo = mid
    }
  }
  const hiElement = lines[hi]
  if (hiElement === undefined) {
    return { previous: undefined, next: undefined }
  }
  const hiBounds = getElementBoundsOfInfluence(hiElement)
  if (hi >= 1 && hiBounds.top > position) {
    const loElement = lines[lo]
    return { previous: loElement, next: hiElement }
  }
  if (hi > 1 && hi < lines.length && hiBounds.top + hiBounds.height > position) {
    return { previous: hiElement, next: lines[hi + 1] }
  }
  return { previous: hiElement }
}

const getEditorLineNumberForPageOffset = (offset) => {
  const { previous, next } = getLineElementsAtPageOffset(offset)
  if (previous != null) {
    const previousBounds = getElementBoundsOfInfluence(previous)
    const offsetFromPrevious = (offset - window.scrollY - previousBounds.top)
    if (next != null && previousBounds.top !== getElementBoundsOfInfluence(next).top) {
      const progressBetweenElements = offsetFromPrevious / (getElementBoundsOfInfluence(next).top - previousBounds.top)
      const line = previous.line + progressBetweenElements * (next.line - previous.line)
      return Math.max(line, 1)
    } else {
      const progressWithinElement = offsetFromPrevious / (previousBounds.height)
      const line = previous.line + progressWithinElement
      return Math.max(line, 1)
    }
  }
  return null
}

window.addEventListener('scroll', () => {
  const line = getEditorLineNumberForPageOffset(window.scrollY)
  if (line != null && !isNaN(line)) {
    vscode.postMessage({ type: 'scroll-in-editor', line })
  }
})

window.addEventListener('load', () => {
  // https://code.visualstudio.com/api/extension-guides/webview#scripts-and-message-passing
  vscode = acquireVsCodeApi() // eslint-disable-line no-undef

  preview = document.querySelector('#preview')
  textarea = document.querySelector('#textarea')
  sendButton = document.querySelector('#sendButton')
  sendButton.addEventListener('click', sendUpdatedXML)

  preview.innerHTML = '' // remove the "JS did not run" message

  // Handle the message inside the webview
  window.addEventListener('message', event => {
    const request = event.data
    const type = request.type
    if (type === 'refresh') {
      handleRefresh(request.xml)
    } else if (type === 'scroll-in-preview') {
      scrollToElementOfSourceLine(parseFloat(request.line))
    } else {
      throw new Error(`Unexpected request type ${type}`)
    }
  })
})

const sourceLineElements = () => {
  const elements = []
  for (const element of document.querySelectorAll('[data-line]')) {
    const line = parseInt(element.getAttribute('data-line'))
    elements.push({ line, element })
  }
  return elements
}

const elementsOfSourceLine = (line) => {
  const lineOfInterest = Math.floor(line)
  const elements = sourceLineElements()
  const nextIndex = elements.findIndex(entry => {
    return entry.line > lineOfInterest
  })
  if (nextIndex <= 0) {
    return { previous: elements[0] ?? null, next: elements[0] ?? null }
  }
  const next = elements[nextIndex]
  const previousLine = elements[nextIndex - 1].line
  const previous = elements.find(entry => {
    return entry.line === previousLine
  })
  return { previous, next }
}

const scrollToElementOfSourceLine = (line) => {
  const { previous, next } = elementsOfSourceLine(line)
  if (previous == null) {
    return
  }
  const previousBounds = previous.element.getBoundingClientRect()
  let scrollOffset
  if (next != null && next.line !== previous.line) {
    const betweenProgress = (line - previous.line) / (next.line - previous.line)
    const elementOffset = next.element.getBoundingClientRect().top - previousBounds.top
    scrollOffset = previousBounds.top + (betweenProgress * elementOffset)
  } else {
    // This should only happen when everything is on one line, I think?
    const progressInElement = line - Math.floor(line)
    scrollOffset = previousBounds.top + (previousBounds.height * progressInElement)
  }
  window.scroll(window.scrollX, window.scrollY + scrollOffset)
}

const elementMap = new Map()
elementMap.set('media', 'div')
elementMap.set('image', 'img')
elementMap.set('para', 'p')
elementMap.set('list', 'ul')
elementMap.set('item', 'li')
elementMap.set('title', 'h2')
// elementMap.set('link', 'a')
elementMap.set('term', 'strong')
elementMap.set('strong', 'strong')
elementMap.set('emphasis', 'em')
elementMap.set('figure', 'figure')
elementMap.set('caption', 'figcaption')
elementMap.set('metadata', null) // Removes the element entirely

let currentVDom

const handleRefresh = (xml) => {
  textarea.value = xml

  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xml, 'text/xml')

  function translateTag(tagName) {
    tagName = tagName.toLowerCase().replace('m:', '') // MathJax does not like `m:` prefix on MathML elements
    return elementMap.has(tagName) ? elementMap.get(tagName) : tagName
  }

  function recBuildVDom(xmlNode) {
    switch (xmlNode.nodeType) {
      case Node.ELEMENT_NODE: {
        const tagName = translateTag(xmlNode.tagName)
        if (!tagName) { return null } // this is an element we want removed (metadata)
        const children = [...xmlNode.childNodes]
          .map(c => recBuildVDom(c))
          .filter(c => !!c) // remove any null children (comments, processing instructions, etc)
        const props = {}
        for (const attr of xmlNode.attributes) {
          props[attr.name] = attr.value
        }
        if (tagName === 'math') {
          // wrap the math because MathJax likes to replace one <math> with 3 elements and the vdom does not like that
          return vdom_h(MATH_WRAPPER_TAGNAME, {}, [vdom_h(tagName, props, ...children)])
        } else {
          return vdom_h(tagName, props, ...children)
        }
      }
      case Node.TEXT_NODE: {
        return xmlNode.nodeValue
      }
      default: {
        // ignore anything else by returning null
        return null
      }
    }
  }

  const newVDom = recBuildVDom(xmlDoc.documentElement)
  vdom_patch(preview, newVDom, currentVDom)
  currentVDom = newVDom

  window.MathJax ? window.MathJax.Hub.Typeset(preview) : document.body.append('[MathJax is not loaded]')
}

function sendUpdatedXML() {
  const xml = textarea.value
  vscode.postMessage({ type: 'direct-edit', xml })
}

/* VirtualDOM */
//
// Public methods are vdom_h(...) and vdom_patch(...)
//
// From https://github.com/philschatz/accessible-engine/blob/master/src/browser/vdom.ts
// Original: https://medium.com/@deathmood/how-to-write-your-own-virtual-dom-ee74acc13060
/* eslint-disable @typescript-eslint/naming-convention, camelcase */
function vdom_h(type, props, ...children) {
  // if (isFunction(type)) {
  //   const t = (type as any) as Fn
  //   return t(props)
  // }
  if (__vdom__isArray(__vdom__head(children))) {
    children = __vdom__head(children)
  }
  return { type, props: props || {}, children }
}
function __vdom__createElement(node) {
  if (typeof node === 'string') {
    return document.createTextNode(String(node))
  }
  const $el = document.createElement(node.type)
  __vdom__applyProps($el, node.props)
  node.children.map(child => $el.appendChild(__vdom__createElement(child)))
  return $el
}
function vdom_patch($parent, newTree, oldTree, index = 0) {
  if (oldTree === undefined) {
    $parent.appendChild(__vdom__createElement(newTree))
  } else if (newTree === undefined) {
    __vdom__removeChildren($parent, index)
  } else if (__vdom__changed(newTree, oldTree)) {
    $parent.replaceChild(__vdom__createElement(newTree), $parent.childNodes[index])
  } else if (typeof newTree !== 'string') {
    if (typeof oldTree === 'string') {
      throw new Error('BUG: Unreachable! __vdom__changed should detect disparate types')
    }
    __vdom__applyProps($parent.childNodes[index], newTree.props, oldTree.props)
    if (newTree.type !== 'math') { // replacing math nodes is handled in a hacky way in the step above
      __vdom__patchNodes($parent, newTree, oldTree, index)
    }
  }
}
function __vdom__toString(a) {
  return JSON.stringify(a)
}
// This added check should replace the whole <mathwrapper> whenever the math inside changes
function __vdom__checkFullIfMath(a, b) {
  if (a.type !== b.type) { return true }
  if (a.type === MATH_WRAPPER_TAGNAME) {
    return __vdom__toString(a) !== __vdom__toString(b)
  }
}
function __vdom__changed(a, b) {
  return (typeof a !== typeof b) ||
    (!__vdom__isObject(a) && a !== b) ||
    (typeof a === 'string' || typeof b === 'string' ? a !== b : __vdom__checkFullIfMath(a, b))
}
function __vdom__patchNodes($parent, newTree, oldTree, index) {
  const len = Math.max(newTree.children.length, oldTree.children.length)
  let i = -1
  while (++i < len) {
    if (!$parent.childNodes[index]) {
      console.log($parent)
      throw new Error(`BUG: VDom Found null child in $parent ${i}`)
    }
    vdom_patch($parent.childNodes[index], newTree.children[i], oldTree.children[i], i)
  }
}
function __vdom__removeChildren($parent, index) {
  let times = ($parent.childNodes.length || 0) - index
  while (times-- > 0) {
    if ($parent.lastChild) {
      $parent.removeChild($parent.lastChild)
    }
  }
}
function __vdom__applyProps($el, newProps, oldProps = {}) {
  const props = __vdom__merge(newProps, oldProps)
  Object.keys(props).forEach(name => {
    const newValue = newProps[name]
    const oldValue = oldProps[name]
    if (__vdom__isObject(newValue)) {
      throw new Error('Does not support setting multiple attributes on an element')
      // applyProps($el[name], (newValue as any) as ObjectLiteral, (oldValue as any) as ObjectLiteral)
    } else {
      if (!newValue) {
        __vdom__removeProp($el, name)
      } else if (newValue !== oldValue) {
        __vdom__setProp($el, name, newValue)
      }
    }
  })
}
function __vdom__setProp($el, name, value) {
  if (name === 'className') {
    $el.setAttribute('class', value)
  } else {
    $el.setAttribute(name, value)
  }
}
function __vdom__removeProp($el, name) {
  if (name === 'className') {
    $el.removeAttribute('class')
  } else {
    $el.removeAttribute(name)
  }
}
function __vdom__isObject(x) {
  return typeof x === 'object' && x != null
}
const __vdom__isArray = Array.isArray || function (obj) {
  return Object.prototype.toString.call(obj) === '[object Array]'
}
function __vdom__head(x) {
  return typeof x === 'string' ? x.charAt(0) : x[0]
}
function __vdom__merge(a, b) {
  return Object.assign({}, a, b)
}
/* eslint-enable @typescript-eslint/naming-convention, camelcase */
