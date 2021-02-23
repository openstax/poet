#!/usr/bin/env bash

set -xeo pipefail
rm -rf ./client/out/
rm -rf ./.nyc_output/
rm -rf ./client/dist/
rm -rf ./client/out/
rm -rf ./server/dist/
rm -rf ./server/out/

$(npm bin)/tsc --build
npm run webpack
cp -r ./client/dist/* ./client/out/
cp -r ./client/src/test/data/ ./client/out/test/data/
nyc instrument --compact=false --source-map --in-place ./client/out/ ./client/out/
# nyc instrument --compact=false --source-map --in-place ./server/out/ ./server/out/
