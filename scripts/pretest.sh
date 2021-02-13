#!/usr/bin/env bash

set -xeo pipefail
rm -rf ./out/
rm -rf ./out-instrumented/
rm -rf ./.nyc_output/
mkdir -p ./.nyc_output/
mkdir -p ./out-instrumented/
tsc --project ./tsconfig.json
webpack --mode development
cp -r ./dist/* ./out/
cp -r ./src/test/data/ ./out/test/data/
cp -r ./out/* ./out-instrumented/
nyc instrument --compact=false --source-map ./out/ ./out-instrumented/
