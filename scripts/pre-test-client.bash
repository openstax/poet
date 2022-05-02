#!/usr/bin/env bash

set -xeo pipefail

test_repo_dest=./client/out/test/data/test-repo

echo '==> Move directories'
[[ -d "${test_repo_dest}" ]] || mkdir -p "${test_repo_dest}"
cp -r ./collections "${test_repo_dest}"
cp -r ./media "${test_repo_dest}"
cp -r ./modules "${test_repo_dest}"
cp -r ./.vscode "${test_repo_dest}"
