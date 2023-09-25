#!/usr/bin/env sh

set -eu

version="$VERSION"
HERE="$(cd "$(dirname "$0")"; pwd)"

cd "$HERE"/..
jq --arg version "$version"  '. + {version: $version}' \
    package.json > package-with-version.json
mv package-with-version.json package.json
npm install
npm run clean && npm run build:production
