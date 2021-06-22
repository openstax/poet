Image Upload dialog
===================

2021-06-17:
Image upload is currently deactivated because it's in "alpha" state:
* It's not working 100% reliable
* UX is confusing. Currently drag&drop of the image onto the "upload" button is required and then a click on "upload".

## How to activate image upload dialog again:

Add lines into `/package.json`:
```json
  "contributes": {
    "commands": [
      ...
      {
        "comand": "openstax.showImageManager",
        "title": "Show Image Upload",
        "category": "Openstax"
      },
      ...
    ]
  }
```

Change `""viewsWelcome"`->`"contents"` value in `/package.json` and add `[Open Image Upload](command:openstax.showImageManager)\n`. Example:

```json
    ...
    "viewsWelcome": [
      {
        "view": "openstax-controls",
        "contents": "[Open ToC Editor](command:openstax.showTocEditor)\n[Open Image Upload](command:openstax.showImageManager)\n[Push Content](command:openstax.pushContent)\n[Tag Content](command:openstax.tagContent)"
      }
    ],
    ...
```