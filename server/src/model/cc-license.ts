import { expectValue } from './utils'

export interface CCLicense {
  url: string
  type: string
  version: string
  text: string
}

const LICENSE_ATTRIBUTES: Record<string, string> = {
  by: 'Attribution',
  nc: 'NonCommercial',
  nd: 'NoDerivatives',
  sa: 'ShareAlike'
}

const LICENSE_PATTERN = /https?:\/\/creativecommons\.org\/licenses\/([a-z-]+)\/(\d\.\d)\/?(deed\..+)?/

export function getCCLicense(licenseUrl: string, licenseText: string): CCLicense {
  const match = expectValue(licenseUrl.match(LICENSE_PATTERN), `Unrecognized licenseUrl: "${licenseUrl}"`)
  const attributes = match[1]
  const version = match[2]
  const isLocalized = match[3] !== undefined
  const type = 'Creative Commons ' + attributes.split('-')
    .map(attr => expectValue(LICENSE_ATTRIBUTES[attr], 'Unrecognized CC license attribute'))
    .join('-')
  const text = isLocalized || type.length === 0
    ? licenseText.trim()
    : type + ' License'
  const url = !isLocalized && !licenseUrl.endsWith('/')
    ? licenseUrl + '/'
    : licenseUrl
  if (text === undefined || text.length === 0) {
    throw new Error('Expected license text')
  }

  return { url, type, version, text }
}

export function licenseEqual(a: CCLicense, b: CCLicense): boolean {
  return a.type === b.type &&
    a.text === b.text &&
    a.type === b.type &&
    a.url === b.url &&
    a.version === b.version
}
