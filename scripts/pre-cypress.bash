#!/usr/bin/env bash

set -eo pipefail

macos_arg=''
if [[ "$(uname)" == 'Darwin' ]]; then
    macos_arg='-e'
fi

echo '==> Edit the Cypress HTML files to load javascript'
find ./client/dist/ -name *.html -exec sed -i ${macos_arg} -E "s/(script-src.+)[;]/\1 'unsafe-eval';/g" {} \;
