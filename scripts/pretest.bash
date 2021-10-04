#!/usr/bin/env bash

set -xeo pipefail

test_repo_dest=./client/out/client/src/test/data/test-repo

echo '==> Move directories'
cp -r ./client/dist/* ./client/out/
[[ -d "${test_repo_dest}" ]] || mkdir -p "${test_repo_dest}"
cp -r ./collections "${test_repo_dest}"
cp -r ./media "${test_repo_dest}"
cp -r ./modules "${test_repo_dest}"
cp -r ./.vscode "${test_repo_dest}"

echo '==> Instrument the client source files'
$(npm bin)/nyc instrument \
    --exclude 'client/out/client/src/test/**/*' \
    --exclude-node-modules \
    --compact=false \
    --source-map \
    --in-place \
    ./client/out/ \
    ./client/out/

macos_arg=''
if [[ "$(uname)" == 'Darwin' ]]; then
    macos_arg='-e'
fi

echo '==> Edit the Cypress HTML files to load javascript'
find ./client/out/ -name *.html -exec sed -i ${macos_arg} -E "s/(script-src.+)[;]/\1 'unsafe-eval';/g" {} \;
