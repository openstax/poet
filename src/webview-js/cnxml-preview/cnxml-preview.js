let vscode;

let preview;
let sendButton;
let textarea;

let isLoaded = false;
let pendingMessage = null;

const MATH_WRAPPER_TAGNAME = 'mathwrapper';

window.addEventListener('load', () => {
	// https://code.visualstudio.com/api/extension-guides/webview#scripts-and-message-passing
	try {
		vscode = acquireVsCodeApi();
	} catch (e) {
		// Not running as a VS Code webview - maybe testing in external browser.
		console.error(e.message);
	}

	preview = document.querySelector('#preview');
	textarea = document.querySelector('#textarea');
	sendButton = document.querySelector('#sendButton');
	sendButton.addEventListener('click', sendUpdatedXML);

	preview.innerHTML = ''; // remove the "JS did not run" message

	isLoaded = true;
	if (pendingMessage) {
		messageHandler(pendingMessage);
	}
});

// Handle the message inside the webview
window.addEventListener('message', event => {
	const message = event.data;
	if (isLoaded) {
		messageHandler(message);
	} else {
		pendingMessage = message;
	}
});


const elementMap = new Map();
elementMap.set('image', 'img');
elementMap.set('para', 'p');
elementMap.set('list', 'ul');
elementMap.set('item', 'li');
elementMap.set('title', 'h2');
// elementMap.set('link', 'a')
elementMap.set('term', 'strong');
elementMap.set('strong', 'strong');
elementMap.set('emphasis', 'em');
elementMap.set('figure', 'figure');
elementMap.set('caption', 'figcaption');
elementMap.set('metadata', null); // Removes the element entirely

let currentVDom = undefined;


function messageHandler(message) {
	const xml = message.xml;

	textarea.value = xml;

	const parser = new DOMParser();
	const xmlDoc = parser.parseFromString(xml,"text/xml");

	function translateTag(tagName) {
		tagName = tagName.toLowerCase().replace('m:', ''); // MathJax does not like `m:` prefix on MathML elements
		return elementMap.has(tagName) ? elementMap.get(tagName) : tagName;
	}

	function recBuildVDom(xmlNode) {
		switch (xmlNode.nodeType) {
			case Node.ELEMENT_NODE:
				const tagName = translateTag(xmlNode.tagName);
				if (!tagName) { return null; } // this is an element we want removed (metadata)
				const children = [...xmlNode.childNodes]
					.map(c => recBuildVDom(c))
					.filter(c => !!c); // remove any null children (comments, processing instructions, etc)
				const props = {};
				for (const attr of xmlNode.attributes) {
					props[attr.name] = attr.value;
				}
				if (tagName === 'math') {
					// wrap the math because MathJax likes to replace one <math> with 3 elements and the vdom does not like that
					return vdom_h(MATH_WRAPPER_TAGNAME, {}, [vdom_h(tagName, props, ...children)]);
				} else {
					return vdom_h(tagName, props, ...children);
				}
				break;
			case Node.TEXT_NODE:
				return xmlNode.nodeValue;
				break;
			default:
				// ignore anything else by returning null
				return null;
		}
	}

	const newVDom = recBuildVDom(xmlDoc.documentElement);
	vdom_patch(preview, newVDom, currentVDom);
	currentVDom = newVDom;



	if (window.MathJax) {
		window.MathJax.Hub.Typeset(preview);
	} else {
		document.body.append(`[MathJax is not loaded]`);
	}
}

function sendUpdatedXML() {
	const xml = textarea.value;
	vscode.postMessage({xml});
}





/* VirtualDOM */
//
// Public methods are vdom_h(...) and vdom_patch(...)
//
// From https://github.com/philschatz/accessible-engine/blob/master/src/browser/vdom.ts
// Original: https://medium.com/@deathmood/how-to-write-your-own-virtual-dom-ee74acc13060
/* eslint-disable @typescript-eslint/naming-convention */
function vdom_h(type, props, ...children) {
    // if (isFunction(type)) {
    //   const t = (type as any) as Fn
    //   return t(props)
    // }
    if (__vdom__isArray(__vdom__head(children))) {
        children = __vdom__head(children);
    }
    return { type, props: props ? props : {}, children };
}
function __vdom__createElement(node) {
    if (typeof node === 'string') {
        return document.createTextNode(String(node));
    }
    const $el = document.createElement(node.type);
    __vdom__applyProps($el, node.props);
    node.children.map(child => $el.appendChild(__vdom__createElement(child)));
    return $el;
}
function vdom_patch($parent, newTree, oldTree, index = 0) {
    if (oldTree === undefined) {
        $parent.appendChild(__vdom__createElement(newTree));
    }
    else if (newTree === undefined) {
        __vdom__removeChildren($parent, index);
    }
    else if (__vdom__changed(newTree, oldTree)) {
        $parent.replaceChild(__vdom__createElement(newTree), $parent.childNodes[index]);
    }
    else if (typeof newTree !== 'string') {
        if (typeof oldTree === 'string') {
            throw new Error('BUG: Unreachable! __vdom__changed should detect disparate types');
        }
        __vdom__applyProps($parent.childNodes[index], newTree.props, oldTree.props);
		if (newTree.type !== 'math') { // replacing math nodes is handled in a hacky way in the step above
			__vdom__patchNodes($parent, newTree, oldTree, index);
		}
    }
}
function __vdom__toString(a) {
	return JSON.stringify(a);
}
// This added check should replace the whole <mathwrapper> whenever the math inside changes
function __vdom__checkFullIfMath(a, b) {
	if (a.type !== b.type) { return true; }
	if (a.type === MATH_WRAPPER_TAGNAME) {
		return __vdom__toString(a) !== __vdom__toString(b);
	}
}
function __vdom__changed(a, b) {
	return (typeof a !== typeof b) 
		|| (!__vdom__isObject(a) && a !== b) 
		|| (typeof a === 'string' || typeof b === 'string' ? a !== b : __vdom__checkFullIfMath(a, b));
}
function __vdom__patchNodes($parent, newTree, oldTree, index) {
    const len = Math.max(newTree.children.length, oldTree.children.length);
	let i = -1;
    while (++i < len) {
        if (!$parent.childNodes[index]) {
            console.log($parent);
            throw new Error(`BUG: VDom Found null child in $parent ${i}`);
        }
        vdom_patch($parent.childNodes[index], newTree.children[i], oldTree.children[i], i);
    }
}
function __vdom__removeChildren($parent, index) {
    let times = ($parent.childNodes.length || 0) - index;
    while (times-- > 0) {
        if ($parent.lastChild) {
            $parent.removeChild($parent.lastChild);
        }
    }
}
function __vdom__applyProps($el, newProps, oldProps = {}) {
    const props = __vdom__merge(newProps, oldProps);
    Object.keys(props).map(name => {
        const newValue = newProps[name];
        const oldValue = oldProps[name];
        if (__vdom__isObject(newValue)) {
            throw new Error('Does not support setting multiple attributes on an element');
            // applyProps($el[name], (newValue as any) as ObjectLiteral, (oldValue as any) as ObjectLiteral)
        }
        else {
            if (!newValue) {
                __vdom__removeProp($el, name);
            }
            else if (newValue !== oldValue) {
                __vdom__setProp($el, name, newValue);
            }
        }
    });
}
function __vdom__setProp($el, name, value) {
    if (name === 'className') {
        $el.setAttribute('class', value);
    }
    else {
        $el.setAttribute(name, value);
    }
}
function __vdom__removeProp($el, name) {
    if (name === 'className') {
        $el.removeAttribute('class');
    }
    else {
        $el.removeAttribute(name);
    }
}
function __vdom__isObject(x) {
    return typeof x === 'object' && x != null;
}
const __vdom__isArray = Array.isArray || function (obj) {
    return Object.prototype.toString.call(obj) === '[object Array]';
};
function __vdom__head(x) {
    return typeof x === 'string' ? x.charAt(0) : x[0];
}
function __vdom__merge(a, b) {
    return Object.assign({}, a, b);
}
/* eslint-enable @typescript-eslint/naming-convention */
