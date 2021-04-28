let vscode

let preview

const MATH_WRAPPER_TAGNAME = 'mathwrapper'

// YANK THESE TYPES https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/preview-src/scroll-sync.ts

/**
 * For a given element, provide the bounds in the document where the element
 * is the most recent element that has had its start tag appear.
 * The correctness of this function relies on all parent elements being
 * larger in bounds than their children. Even if this isn't the case, the minimum
 * bounds height value will still be 1.
 */
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

/**
 * Given an offset, binary search for the two elements whose bounds begin
 * immediately previously and immediately next after the y-position represented by
 * the offset from the top of the page
 */
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

/**
 * Given an offset from the top of the page, find the two elements whose
 * bounds begin immediately previously and immediately next after the y-position
 * represented by the offset. Then based on the line numbers of the two
 * elements and where offset y-position lies between the two bounds, interpolate
 * a line number (which is not necessarily an integer) for the offset.
 */
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

/**
 * Create pairings of elements and the line numbers of those elements in the editor
 */
const sourceLineElements = () => {
  const elements = []
  for (const element of document.querySelectorAll('[data-line]')) {
    const line = parseInt(element.getAttribute('data-line'), 10)
    elements.push({ line, element })
  }
  return elements
}

/**
 * For a given source line (which is not necessarily an integer), determine
 * the pair of preview elements which satisfy the following:
 *   previous:
 *     the element which has the largest line number which is less
 *     than the given line, ties going to the first appearing element
 *   next:
 *     the element which has the smallest line number which is greater
 *     than the given line, ties going to the first appearing element
 * The region between the top of previous and the top of next represents the
 * space in the preview in which at all y positions some element with the same
 * line as previous (although we have no idea which element) is the most
 * recently appearing element
 */
const elementsOfSourceLine = (line) => {
  const lineOfInterest = Math.floor(line)
  const elements = sourceLineElements()
  const nextIndex = elements.findIndex(entry => {
    return entry.line > lineOfInterest
  })
  if (nextIndex === 0) {
    return { previous: elements[0] ?? null, next: elements[0] ?? null }
  }
  if (nextIndex === -1) {
    const lastIndex = elements.length - 1
    // Essentially: Are all the elements on one line?
    return (!elements.some(entry => entry.line < lineOfInterest))
      ? { previous: elements[0] ?? null, next: elements[lastIndex] ?? null } // If so, our region is the full page
      : { previous: elements[lastIndex] ?? null, next: elements[lastIndex] ?? null } // If not, we are beyond all the content
  }
  const next = elements[nextIndex]
  const previousLine = elements[nextIndex - 1].line
  const previous = elements.find(entry => {
    return entry.line === previousLine
  })
  return { previous, next }
}

/**
 * Given a source line as a float, with the integer portion representing a
 * line (L), and the decimal portion representing the progress through that
 * line (P), scroll to the y-position of the preview in which we are (P*100)%
 * of the way through the region between the top of first appearing element
 * with the highest line number less than L and the top of the first appearing
 * element with the lowest line number greater than L.
 * If there is no element with a line number less than or greater than L,
 * scroll (P*100)% of the way through the content of the first appearing element
 */
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
  } else { // This should only happen when everything is on one line
    // We may be past all the content, bound the line to the greatest line nubmer with 100% progress,
    line = Math.min(line, previous.line + 1)
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
      /* istanbul ignore next */
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
      /* istanbul ignore next */
      throw new Error(`BUG: VDom Found null child at index ${i} in '${$parent.tagName}'`)
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
      /* istanbul ignore next */
      throw new Error('Does not support setting multiple attributes on an element')
      // applyProps($el[name], (newValue as any) as ObjectLiteral, (oldValue as any) as ObjectLiteral)
    } else {
      if (!newValue) {
        $el.removeAttribute(name)
      } else if (newValue !== oldValue) {
        $el.setAttribute(name, newValue)
      }
    }
  })
}
function __vdom__isObject(x) {
  return typeof x === 'object' && x != null
}
const __vdom__isArray = Array.isArray || function (obj) {
  /* istanbul ignore next */
  return Object.prototype.toString.call(obj) === '[object Array]'
}
function __vdom__head(x) {
  return typeof x === 'string' ? x.charAt(0) : x[0]
}
function __vdom__merge(a, b) {
  return Object.assign({}, a, b)
}
/* eslint-enable @typescript-eslint/naming-convention, camelcase */
