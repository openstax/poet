#!/usr/bin/env sh

set -eu

version="$VERSION"
publisher="$PUBLISHER"
vsce_token="$VSCE_TOKEN"
HERE="$(cd "$(dirname "$0")"; pwd)"

"$HERE"/build-for-release.sh "$version"

cd "$HERE"/..
echo "$vsce_token" | npx vsce login "$publisher"
npx vsce publish "$version"
