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

To show/verify that the model works outside the language server, here are a couple useful CLI scripts:

## Lint a book and find broken redirects

To run it:

```bash
npx ts-node@10.1.0 ./src/model/_cli.ts lint /path/to/book/repo /path/to/another/book/repo
```

## Find orphaned files

To run it:

```bash
npx ts-node@10.1.0 ./src/model/_cli.ts orphans /path/to/book/repo /path/to/another/book/repo
```


## Create a smaller book

Specify which books and which items in the ToC to keep (chapters/Pages, 0-indexed) and this will delete unused images, pages, and books while keeping the repo valid.

**Note:** If you specify a Page that links to another book, that Page will be included in the set of pages that are kept, even if it is in another book.

```bash
# Keep the Preface and Chapter 3 of precalc and the Chapter 10 Introduction in Algebra&Trig
npx ts-node@10.1.0 ./src/model/_cli.ts shrink /path/to/osbooks-college-algebra-bundle precalculus-2e:0,3 algebra-and-trigonometry-2e:10.0
```