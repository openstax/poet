#!/usr/bin/env sh

set -eu

version="$VERSION"
openvsx_token="$OPENVSX_TOKEN"
HERE="$(cd "$(dirname "$0")"; pwd)"

"$HERE"/build-for-release.bash "$version"

cd "$HERE"/..
npm install ovsx
npx ovsx publish editor-*.vsix -p "$openvsx_token"
