# Implementation notes

# High level organization

- [model/](./src/model/) : The book model. Contains no VSCode, filesystem, or other editor dependencies. Just a model of the book
- [model-adapter.ts](./src/model-adapter.ts) : VSCode-specific glue code between the model and the event handlers
- Job Runner : A Stack of async jobs that need to run. These jobs have a slow/fast flag
- [server.ts](./src/server.ts) : Just all the Language Server event handlers. Most logic is delegated to model-adapter.


# More detailed

This model has the following features which allow it to be pulled out and used in other places like for validation:

1. no filesystem
1. no async
1. DOM is discarded after being parsed
1. source location is remembered

Each file is corresponds to a node in the model ([Bundle](./model/bundle.ts), [Book](./model/book.ts), [Page](./model/page.ts), Image).

The Bundle is the root instance of a repository.

Nodes are instantiated by a Factory on the Bundle.

Nodes are empty until the user loads data into them.

After loading content into the node, validation errors can be found on the node.

Validation responses can either be a set of Errors with source line information or a set of nodes that need to be loaded first before validation can complete.


# Demo commandline validator

To show/verify that the model works outside the language server, there is a CLI script that can validate a book repository.

To run it:

```bash
npx ts-node@10.1.0 ./src/model/_cli.ts /path/to/book/repo /path/to/another/book/repo
```

---

Slides for Language Server talk

# What is a Language Server?

- A process that speaks the Language Server Protocol
- Can be written in any language as long as it supports a JSON stream or HTTP webserver API
- Upon an initialization request it responds with all the features it implements
- Features include: autocompletion, debuggers, syntax problems, source links, tooltips, ...

# Portable?

The Language Server Protocol is not specific to VSCode. You can use POET in other popular editors (Vim/Emacs)


# How the POET extension uses a Langauge Server

Our Language server mostly listens to updates in CNXML and COLLXML files as well as images and the /META-INF/books.xml manifest file.

Specifically, Language Server listens to (server.ts):
    - File change events (to update our repo model)
    - XML Document updates (before saving occurs)
    - dot-completion when creating image links
    - links to other CNXML modules
    - Custom "ToC Update" events and updates the in-memory model and files
    - Syntax Errors (VSCode Diagnostics) whenever the in-memory model changes


# The Book Model

We use Relax-NG and XSD to validate the XML files but XSD has limitations. We validate the following in the Language Server:

- [bundle.ts](https://github.com/openstax/poet/blob/main/server/src/model/bundle.ts#L56-L63) Missing book COLLXML file, 0 books in a bundle
- [book.ts](https://github.com/openstax/poet/blob/main/server/src/model/book.ts#L136-L152) Missing Pages, Duplicate Chapter titles, Duplicate Pages
- [page](https://github.com/openstax/poet/blob/main/server/src/model/page.ts#L166) Missing images, missing target pages, missing target elements in a page, duplicate UUIDs, malformed UUID
- And all orphaned books, pages, & images


The [server/model/](https://github.com/openstax/poet/blob/main/server/src/model) directory contains all the parsing & validation logic. Notably, it has the following explicit requirements:

- **NO** async code
- **NO** filesystem read/write
- **NO** VSCode imports
- **NO** null pointers
    - This means a link to a Page that does not exist will link to a Page object (whose `.exists` is false)
- **NO** duplicate objects that represent the same "Book" object
    - This means 2 objects that represent m123 will **always** be `===` to each other

These requirements have a few consequences. Every Bundle/Book/Page/Image has:

- `.isLoaded()` and `.load(fileContents)` methods
- `.exists()` method
- `.getValidationErrors()` method


The CLI instantiates a model that's [wired up](https://github.com/openstax/poet/blob/main/server/src/model/_cli.ts#L27-L30) to the filesystem and the VSCode LanguageServer instantiates a model that's hooked up to VSCode APIs. The latter allows the LanguageServer to [validate content before it's saved](https://github.com/openstax/poet/blob/main/server/src/server.ts#L121-L124) to the filesystem.


# Freebie: Commandline client

Since the model is filesystem-agnostic, a commandline client is implemented by writing [50 lines of code](https://github.com/openstax/poet/blob/main/server/src/model/_cli.ts).

This can be used for book validation in CI tests or QA.


# Validation Errors (aka "Problems" section aka Diagnostics)

The way Validation errors show up in the "Problems" area of VSCode is:

Initial Setup:
1. The extension client starts up, spawns our Language Server, and registers it with VSCode
1. The Langauge Server tells VSCode that it's interested in DocumentChanged Events

Steps:
1. The user types a letter on their keyboard
1. VSCode sends the LanguageServer a DocumentChanged event
1. LangServer updates the model
1. As part of sending Diagnostics events (see [Lang Server Protocol](https://microsoft.github.io/language-server-protocol/specifications/specification-current/#diagnostic)) LangServer asks the model for validation errors and then builds up a Diagnostics entry for each file


# Asynchronous Loading

https://github.com/openstax/poet/blob/main/server/src/job-runner.ts

To speed up and give validation errors before the whole book is loaded and because the model is synchronous we have a Job queue that, given a model object, loads it and its dependencies.

There are 2 priorities in the queue: low-priority jobs that load all the books and high-priority jobs that are whichever file is currently open in the editor.


# More Implementation Details

## Quarx

Rather than keeping track of which files need to be re-parsed when a file changes (added/edited/removed) and then send Diagnostics events to the extension client, we use a tiny library called [quarx](https://github.com/dmaevsky/quarx).

It's mobx but has the following features:

- synchronous
- 200 lines

Here's an example: https://github.com/dmaevsky/quarx#usage-example


Quarx links:

- quarx library: https://github.com/dmaevsky/quarx
- mutable boxes: https://github.com/openstax/poet/blob/main/server/src/model/page.ts#L49-L53


## Model Manager

This provides an interface between the Model and vscode events that come in to the language server.

It can load files, listens to file update events, creates new files, saves files when the model changes...
