#!/usr/bin/env bash

set -e

OPENVSX_TOKEN=$1
VSCE_TOKEN=$2
RELEASE_TYPE=$3

if [[ ! "$OPENVSX_TOKEN" || ! "$VSCE_TOKEN" ]]; then 
    echo "OPENVSX_TOKEN and VSCE_TOKEN are required"
    exit 1
fi

handle_package_json() {
    backup=$1
    backup_pack="package.json.orig"
    backup_lock="package-lock.json.orig"
    if [[ $backup ]]; then
        cp "package.json" "$backup_pack"
        if [[ -f "package-lock.json" ]]; then
            cp "package-lock.json" "$backup_lock"
        fi
    else
        mv "$backup_pack" "package.json"
        if [[ -f "$backup_lock" ]]; then
            mv "$backup_lock" "package-lock.json"
        fi
    fi
}

handle_package_json true && trap handle_package_json EXIT

# --- Generate version ---
git pull -t > /dev/null
tags="$(git tag -l | awk '/^[0-9]+?\.[0-9]+?\.[0-9]+$/')"
latest="$(echo "$tags" | sort -V | tail -n 1)"
if [ ! "$latest" ]; then
    echo "Could not find existing tagged version"
    exit 1
fi
awk_script=''
case "$RELEASE_TYPE" in
    "major")
        awk_script='{ print $1 + 1".0.0" }'
        ;;
    "minor")
        awk_script='{ print $1"."$2 + 1".0" }'
        ;;
    "patch")
        awk_script='{ print $1"."$2"."$3 + 1 }'
        ;;
    *)
        echo "Unknown release type \"$RELEASE_TYPE\""
        exit 1
        ;;
esac
version="$(echo "$latest" | awk -F '.' "$awk_script")"
if [ "$(echo "$tags" | grep "$version")" ]; then
    echo "Error: Version $version already exists"
    exit 1
fi

# --- Update package.json ---
cp package.json package.json.orig
jq --arg version "$version"  '. + {version: $version}' package.json > package.json.new
mv package.json.new package.json
publisher="$(jq -r '.publisher' package.json)"

# --- Publish ---
npm install
npm run build:production
npm install ovsx
echo "Publishing..."
npx ovsx publish editor-*.vsix -p $OPENVSX_TOKEN
npx vsce login $publisher <<< $VSCE_TOKEN && npx vsce publish $version