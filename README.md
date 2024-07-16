# VSCode Extension to edit textbooks [in gitpod](https://gitpod.io/from-referrer/)
[![Coverage Status](https://img.shields.io/codecov/c/github/openstax/poet.svg)](https://codecov.io/gh/openstax/poet)
[![Gitpod ready-to-code](https://img.shields.io/badge/Gitpod-ready--to--code-blue?logo=gitpod)](https://gitpod.io/from-referrer/)

![installing and enabling the preview](./editor.gif)


Table of Contents
=================

* [Development](#development)
   * [Setup](#setup)
   * [Tests](#tests)
      * [Why 2 test frameworks?](#why-2-test-frameworks)
   * [Quick Startup](#quick-startup)
   * [Debugging](#debugging)
      * [Debugging JavaScript in Webviews](#debugging-javascript-in-webviews)
      * [Debugging Unit Tests](#debugging-unit-tests)
* [Commandline](#commandline)
* [Publishing](#publishing)
   * [Local .vsix](#local-vsix)
* [Design](#design)
   * [Extension Activation](#extension-activation)
   * [Opening a Webview](#opening-a-webview)
   * [Editing Files and Interaction](#editing-files-and-interaction)
* [Generating XSD schema files](#generating-xsd-schema-files)


# Development

## Setup

```sh
npm install
npm run build
```

## Tests

Run all/some of the tests:

```sh
npm run test
# Or: npm run test:unit
# Or: npm run test:unit:watch
# Or: npm run test:cypress
```

### Why 2 test frameworks?

1. `npm run test:unit`: Try to use this first. Jest is fast, works with VSCode's debugger so you can set breakpoints in tests or code, and only reruns tests that are affected by your uncommitted files.
1. `npm run test:cypress`: Use this when you test webviews. It is really slow because it starts up a real browser.


## Quick Startup

1. Run `npm run build`
1. Launch the `[Run Extension]` task in the VSCode _Run and Debug_ panel
1. Open a CNXML file (in [./modules/](./modules) for example)
1. Click the Preview button on the top-right of the editor
1. Launch the `[Attach to Language Server]` from the _Run and Debug_ panel



## Debugging

### Debugging JavaScript in Webviews

Open the Webview Developer Tools by opening the command pallete and selecting `Developer: Open Webview Developer Tools`. This will allow you to inspect the webview contents. **Note:** It can only be opened when the webview is open.

### Debugging Unit Tests

The unit tests can be debugged using the VSCode debugger. There are 2 ways to run the tests:

1. If you run the Unit tests from the `[Run and Debug]` VSCode panel then breakpoints will work.
1. If you want to run the tests from a terminal, follow the instructions to set the [Auto-Attach setting in VSCode](https://code.visualstudio.com/docs/nodejs/nodejs-debugging#_auto-attach) and then run `npm run test:unit` or `npm run test:unit:watch`.

### Debugging in Gitpod (Client and Language Server)

You can debug POET in Gitpod thusly:

1. Open `[Run and Debug]` in the VSCode panel
1. Select and run the `Run Extension` debug configuration from the dropdown
1. Wait for the extension to start in a new tab/window
1. Select and run `Attach to Language Server` debug configuration from the dropdown
1. If all is well, you should be able to set breakpoints in the server and client scripts and debug all the things

# Commandline

A commandline version of POET is available at [./poet](./poet).
It can be run just by cloning this repo which means it can be used in containers that have NodeJS.

## Validate a book

This runs all of the POET validations on a repository:

```bash
$ poet validate <directory>
```

## Find broken links

This finds broken redirects in the content of a book:

```bash
$ poet links <directory>
```


## Find orphaned files

This finds orphaned files in a repository:

```bash
$ poet orphans <directory>
```


## Create a smaller book

Specify which books and which items in the ToC to keep (Chapters or Pages, 0-indexed) and this will delete unused images, pages, and books while keeping the repo valid.

**Note:** If you specify a Page that links to another book, that Page will be included in the set of pages that are kept, even if it is in another book.

Here is an example that keeps the Preface (`0`) and Chapter 3 (`3`) of Precalculus and the Chapter 10 Introduction (`10.0`) of Algebra&Trig:
```bash
$ poet shrink /path/to/osbooks-college-algebra-bundle precalculus-2e:0,3 algebra-and-trigonometry-2e:10.0
```


# Publishing

We rely on [this Concourse pipeline](https://github.com/openstax/concourse-pipelines/tree/master/release-poet) to publish a new version to the [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=openstax.editor) and [OpenVSX.org marketplace](https://open-vsx.org/extension/openstax/editor). That pipeline uses the `build-for-release.sh`, `publish-openvsx.sh`, and `publish-vsce.sh` scripts in the `scripts` directory for publishing. It's not recommended that you run these scripts yourself, but you can if you have the correct credentials.

Example running publish from repo root:
```sh
VERSION=... \
OPENVSX_TOKEN=... \
./scripts/publish-openvsx.sh
```

or for vsce

```sh
VERSION=... \
PUBLISHER=... \
VSCE_TOKEN=... \
./scripts/publish-vsce.sh
```

The process for vsce is the same except that you must supply a publisher as well.

The Major version will _eventually_ track the repo schema version that is supported so try to bump minor/patch versions.


## Local .vsix

Update the version in `package.json` if desired (e.g. to associate with an issue, `0.0.0-dev-cnx1234`). Then:

```sh
npm run build:production
npm run package
```

# Design

## Extension Activation

```mermaid
sequenceDiagram

actor User
participant FS as File System
participant Server as Language Server
participant Host as LSP Client/Extension Host

User->>Host: activate extension
activate Host
Host->>Server:init
activate Server
Server->>FS: list bundle items
activate FS
FS-->>Server: bundle items
deactivate FS
Server-->>Host: ready
deactivate Host

loop async validation for each bundle item
opt if not cached
Server->>FS: get bundle item contents
activate FS
FS-->>Server: bundle item contents
deactivate FS
end
note over Server: validate and cache
Server->>Host: validation diagnostics
deactivate Server
end
```

## Opening a Webview

```mermaid
sequenceDiagram

actor User
participant FS as File System
participant Server as Language Server
participant Host as LSP Client/Extension Host
participant Consumer as Webview/Treeview

User->>Host: open webview/treeview
activate Host
alt handshake
Host->>Consumer: create
activate Consumer
Host->Consumer: send html
Consumer->>Host: loaded, request initial data
deactivate Consumer
Host->>Server: bundle info request
opt if not cached
Server->>FS: get bundle item contents
activate FS
FS-->>Server: bundle item contents
deactivate FS
end
Server-->>Host: bundle info
Host->>Consumer: initial data
else injection
Host->>Consumer: create
activate Consumer
opt
Host->>Consumer: send html with loading message
end
Host->>Server: bundle info request
opt if not cached
Server->>FS: get bundle item contents
activate FS
FS-->>Server: bundle item contents
deactivate FS
end
Server-->>Host: bundle info
Host->>Consumer: send html with injected initial data
deactivate Host
deactivate Consumer
end
```

## Editing Files and Interaction

The Language Server directs all updates. VSCode even sends updates to files before they are saved so the Language Server can react to individual keystrokes. [Quarx](https://github.com/dmaevsky/quarx) is used to detect when models have changed.

```mermaid
sequenceDiagram

actor User
participant VSCode
participant Server as Language Server
participant Quarx
participant Host as LSP Client/Extension Host
participant Consumer as Webview/Treeview

User-->>VSCode: modifies watched file
VSCode-->>Server: Sends document update
Server-->>Server: Updates Model
note over Quarx: Notices Model Changed
Quarx-->>Host: Send updated BooksAndOrphans message
Host-->>Consumer: Sends BooksAndOrphans message
Consumer-->>Consumer: Updates webview panel
Server-->>Host: Sends Diagnostic message with validation errors for the updated file
```

# Generating XSD schema files

The CNXML schema validation in the extension is performed using XSD files generated using the RelaxNG schema files in the `poet-schema` branch of the [cnxml repo](https://github.com/openstax/cnxml). The XSD files can be regenerated using [jing-trang](https://github.com/relaxng/jing-trang.git). You can clone that repo and follow the instructions to build `trang.jar` and `jing.jar`. The following steps assume:

* You have the `jing-trang` repo cloned as a peer of this repo and successfully built the JAR files there (you can otherwise simply modify the paths as necessary for your environment)
* You have the `cnmxl` repo cloned as a peer of this repo

```bash
$ git -C ../cnxml checkout poet-schema
$ java -jar ../jing-trang/build/jing.jar -i -s ../cnxml/cnxml/xml/poet/schema/rng/poet-jing.rng > poet-simplified.rng
$ java -jar ../jing-trang/build/trang.jar -I rng -O xsd poet-simplified.rng client/static/xsd/mathml.xsd
$ patch -p1 < client/static/xsd/trang.patch
$ rm poet-simplified.rng
```
