# Implementation notes

## Book bundle

The book bundle code incorporates data caching using [memoize-one](https://github.com/alexreardon/memoize-one). `Memoize-one` simply caches results for the most recent set of provided arguments. The implementation uses "`Cachified`" versions of objects that incorporate a UUID which can be used to easily determine when object arguments have changed. The following table summarizes class fields that use `memoize-one` caching along with the corresponding arguments and return types:

| Class | Field | Cache arguments | Return type |
| - | - | - | - |
| `ModuleInfo` | `_document` | moduleCNXML: `Cachified<FileData>` | `Cachified<Document>` |
| `ModuleInfo` | `_idsDeclared` | moduleCNXML: `Cachified<Document>` | `Cachified<Map<string, Element[]>>` |
| `ModuleInfo` | `_imageSources` | moduleCNXML: `Cachified<Document>`, bundleMedia: `Cachified<Set<string>>` | `Cachified<ImageSource[]>` |
| `ModuleInfo` | `_imagesUsed` | moduleCNXML: `Cachified<Document>` | `Cachified<Set<string>>` |
| `ModuleInfo` | `_linksDeclared` | moduleCNXML: `Cachified<Document>` | `Cachified<Link[]>` |
| `ModuleInfo` | `_titleFromDocument` | moduleCNXML: `Cachified<Document>` | `Cachified<ModuleTitle>` |
| `ModuleInfo` | `_guessFromFileData` | moduleCNXML: `Cachified<FileData>` | `Cachified<ModuleTitle>` |
| `CollectionInfo ` | `_document` | collectionXML: `Cachified<FileData>` | `Cachified<Document>` |
| `CollectionInfo ` | `_modulesUsed` | collectionXML: `Cachified<Document>` | `Cachified<ModuleLink[]>` |
| `CollectionInfo ` | `_tree` | collectionXML: `Cachified<Document>`, usedModuleTitlesDefined: `Array<Cachified<ModuleTitle>>` | `Cachified<TocTreeCollection>` |
| `BookBundle` | `_orphanedImages` | allImages: `Cachified<Set<string>>`, usedImagesPerModule: `Array<Cachified<Set<string>>>` | `Cachified<Set<string>>` |
| `BookBundle` | `_orphanedModules` | allModules: `Cachified<Map<string, ModuleInfo>>`, usedModulesPerCollection: `Array<Cachified<ModuleLink[]>>` | `Cachified<Set<string>>` |
| `BookBundle` | `_moduleIds` | moduleIdsAsMap: `Cachified<Map<string, Element[]>>` | `Cachified<Set<string>>` |
