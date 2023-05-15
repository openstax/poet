import { expectValue } from './utils'

export interface CCLicense {
  url: string
  type: string
  version: string
  text: string
}

const LICENSE_ATTRIBUTES: Record<string, string> = {
  by: 'Creative Commons Attribution',
  nc: 'NonCommercial',
  nd: 'NoDerivatives',
  sa: 'ShareAlike'
}

export function getCCLicense(licenseUrl: string, licenseText: string): CCLicense {
  expectValue(licenseUrl.length > 0 || null, 'Empty license url')
  const isLocalized = licenseUrl.includes('/deed.')
  if (licenseUrl.endsWith('/')) {
    licenseUrl = licenseUrl.slice(0, licenseUrl.length - 1)
  }
  const [attributes, version] = (
    isLocalized ? licenseUrl.slice(0, licenseUrl.lastIndexOf('/deed.')) : licenseUrl
  ).split('/').slice(-2)
  const type = attributes.split('-')
    .map(attr => expectValue(LICENSE_ATTRIBUTES[attr], 'Unrecognized CC license attribute'))
    .join('-')
  const text = isLocalized || type.length === 0
    ? licenseText.trim()
    : type + ' License'
  if (text === undefined || text.length === 0) {
    throw new Error('Expected license text')
  }

  return { url: licenseUrl, type, version, text }
}

export function licenseEqual(a: CCLicense, b: CCLicense): boolean {
  return a.type === b.type &&
    a.text === b.text &&
    a.type === b.type &&
    a.url === b.url &&
    a.version === b.version
}
