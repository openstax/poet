#!/usr/bin/env bash

set -xeo pipefail

cp -r ./client/dist/* ./client/out/
[[ -d ./client/out/test/data/test-repo/ ]] || mkdir -p ./client/out/test/data/test-repo/
cp -r ./collections/ ./client/out/test/data/test-repo/
cp -r ./media/ ./client/out/test/data/test-repo/
cp -r ./modules/ ./client/out/test/data/test-repo/

macos_arg=''
if [[ "$(uname)" == 'Darwin' ]]; then
    macos_arg='-e'
fi

echo '==> Instrument the client source files'
$(npm bin)/nyc instrument --compact=false --source-map --in-place ./client/out/ ./client/out/

echo '==> Edit the Cypress HTML files to load javascript'
find ./client/out/ -name *.html -exec sed -i ${macos_arg} -E "s/(script-src.+)[;]/\1 'unsafe-eval';/g" {} \;
