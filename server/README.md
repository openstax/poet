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
npx ts-node@10.1.0 ./model/_cli.ts /path/to/book/repo /path/to/another/book/repo
```
