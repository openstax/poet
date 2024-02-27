// RegExp from: vscode/extensions/git/src/git.ts
const lineSep = /\r?\n/
const propertyPattern = /^\s*(\w+)\s*=\s*"?([^"]+)"?$/
const sectionPattern = /^\s*\[\s*([^\]]+?)\s*("[^"]+")*\]\s*$/

export function parseGitConfig(config: string): Record<string, string> {
  let sectionName = ''
  const modulesConfig: Record<string, string> = {}
  for (const line of config.split(lineSep)) {
    // Sections
    const sectionMatch = line.match(sectionPattern)
    if (sectionMatch?.length === 3) {
      const subSectionName = sectionMatch[2]?.replace(/"/g, '')
      sectionName = subSectionName !== undefined
        ? `${sectionMatch[1]}.${subSectionName}`
        : sectionMatch[1]
      continue
    }
    // Properties
    const propertyMatch = line.match(propertyPattern)
    if (propertyMatch?.length === 3) {
      if (sectionName.length === 0) continue
      const key = `${sectionName}.${propertyMatch[1]}`
      modulesConfig[key] = propertyMatch[2]
    }
  }
  return modulesConfig
}
