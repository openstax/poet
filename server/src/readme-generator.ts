import { licenseEqual } from './model/cc-license'
import { expectValue } from './model/utils'

import { type BookNode } from './model/book'

// Maybe these templates should be in files so they can be edited more easily?
const bookTemplate = `\
# {{ book_title }}

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/{{ repoOwner }}/{{ repoName }})

_{{ book_title }}_ is a textbook published by [OpenStax](https://openstax.org/), a non profit organization that is part of [Rice University](https://www.rice.edu/).

The book can be viewed [online]({{ book_link }}), where you can also see a list of contributors.

## License
This book is available under the [{{ license_text }}](./LICENSE) license.

## Support
If you would like to support the creation of free textbooks for students, your [donations are welcome](https://riceconnect.rice.edu/donation/support-openstax-banner).
`

const bundleTemplate = `\
# {{ book_titles }}

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/{{ repoOwner }}/{{ repoName }})

_{{ book_titles }}_ are textbooks published by [OpenStax](https://openstax.org/), a non profit organization that is part of [Rice University](https://www.rice.edu/).

To view these books online and view contributors, please visit:
{{ book_links }}

## License
These books are available under the [{{ license_text }}](./LICENSE) license.

## Support
If you would like to support the creation of free textbooks for students, your [donations are welcome](https://riceconnect.rice.edu/donation/support-openstax-banner).
`

const BOOK_WEB_ROOT = 'https://openstax.org/details/books/'

function populateTemplate(template: string, replacements: Record<string, string>) {
  // '{{ x }}' -> replacements['x']
  return template.replace(/\{{2}.+?\}{2}/g, m => {
    const prop = m.slice(2, -2)
    const value = expectValue(replacements[prop.trim()], `${prop} is undefined`)
    return value
  })
}

function createBookReadme(book: BookNode, extras?: Record<string, string>) {
  const license = book.license
  const replacements = {
    book_title: book.title,
    book_link: `${BOOK_WEB_ROOT}${encodeURIComponent(book.slug)}`,
    license_text: license.text,
    license_type: license.type,
    license_version: license.version,
    ...extras
  }
  return populateTemplate(bookTemplate, replacements)
}

function createBundleReadme(bundle: BookNode[], extras?: Record<string, string>) {
  const firstLicense = bundle[0].license
  if (!bundle.every(book => licenseEqual(book.license, firstLicense))) {
    throw new Error('Licenses differ between collections')
  }
  const replacements = {
    book_titles:
      bundle.map((s, i) =>
        i === bundle.length - 1 ? `and ${s.title}` : s.title
      ).join(bundle.length > 2 ? ', ' : ' '),
    book_links:
      bundle.map(s =>
        `- _${s.title}_ [online](${BOOK_WEB_ROOT}${encodeURIComponent(s.slug)})`
      ).join('\n'),
    license_text: firstLicense.text,
    license_type: firstLicense.type,
    license_version: firstLicense.version,
    ...extras
  }
  return populateTemplate(bundleTemplate, replacements)
}

export function generateReadmeForWorkspace(books: BookNode[], extras?: Record<string, string>) {
  if (books.length > 1) {
    return createBundleReadme(books, extras)
  } else if (books.length > 0) {
    return createBookReadme(books[0], extras)
  } else {
    throw new Error('Got empty book set when generating README')
  }
}
