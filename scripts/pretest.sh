#!/usr/bin/env bash

set -xeo pipefail
rm -rf ./out/
rm -rf ./.nyc_output/
mkdir -p ./.nyc_output/
tsc --project ./tsconfig.json
webpack --mode development
cp -r ./dist/* ./out/
cp -r ./src/test/data/ ./out/test/data/
nyc instrument --compact=false --source-map --in-place ./out/ ./out/
