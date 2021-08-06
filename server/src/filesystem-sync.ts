import path from 'path'
import { FileChangeType, FileEvent } from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";
import { Bundle, Fileish, PathType } from "./model";

// TODO: Use not-slash in the regexp instead of .+
const IMAGE_RE = /\/media\/.+\.(jpg,png,jpeg)$/ 
const PAGE_RE = /\/modules\/[a-z0-9]\/index\.cnxml$/
const BOOK_RE = /\/collections\/[a-z0-9]\.collection\.xml$/

const PATH_SEP = path.sep

export async function processFilesystemChange(evt: FileEvent, bundle: Bundle): Promise<number> {
    const {type, uri} = evt
    const filePath = URI.parse(uri).fsPath
    
    // Could be adding an Image/Page/Book, or removing/adding a directory, or adding some other file
    
    if (evt.type === FileChangeType.Created) {
        // Check if we are adding an Image/Page/Book
        if (IMAGE_RE.test(filePath)) { return bundle.allImages.get(PathType.ABSOLUTE_JUST_ONE_FILE, filePath, '') && 1 }
        else if (PAGE_RE.test(filePath)) { return bundle.allPages.get(PathType.ABSOLUTE_JUST_ONE_FILE, filePath, '') && 1 }
        else if (BOOK_RE.test(filePath)) { return bundle.allBooks.get(PathType.ABSOLUTE_JUST_ONE_FILE, filePath, '') && 1 }
        else {
            // No, we are adding something unknown. Ignore
            console.log('New file did not match anything we understand. Ignoring', filePath)
            return 0
        }
    } else {
        // Check if we are updating/deleting a Image/Page/Book/Bundle
        const item = bundle.allBooks.getIfHas(filePath) ||
            bundle.allPages.getIfHas(filePath) ||
            bundle.allImages.getIfHas(filePath) ||
            bundle.filePath === filePath ? bundle : null

        if (item) { await processItem(type, item); return 1 }

        // Now, we might be deleting a whole directory.
        // Remove anything inside that directory
        const filePathDir = `${filePath}${PATH_SEP}`
        return bundle.allBooks.removeByPathPrefix(filePathDir) +
            bundle.allPages.removeByPathPrefix(filePathDir) +
            bundle.allImages.removeByPathPrefix(filePathDir)
    }
}

async function processItem(type: FileChangeType, item: Fileish) {
    switch(type) {
        case FileChangeType.Deleted:
        case FileChangeType.Changed:
            return await item.update()
        case FileChangeType.Created:
        default:
            throw new Error('BUG: We do not know how to handle created items yet')
    }
}
