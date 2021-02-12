#!/usr/bin/env bash

set -eo pipefail
rm -rf ./out
rm -rf ./.nyc_output
mkdir -p ./.nyc_output
tsc -p ./
webpack --mode development
cp ./dist/* ./out
cp -r ./src/test/data out/test/data
nyc instrument --source-map --in-place ./out/
