import { createMdbookConfig } from "/Users/igor/source/igorboss/mdbook/src/vitepress.mjs"
export default createMdbookConfig({
  "title": "mdbook",
  "description": "",
  "base": "/",
  "siteUrl": null,
  "image": null,
  "defaultLang": "en",
  "langs": [
    "en"
  ],
  "spaceNames": {
    "en": "English"
  },
  "sidebars": {
    "en": {
      "/docs/": [
        {
          "text": "<span class=\"mdbook-icon\"><svg class=\"mdbook-icon-svg\" aria-hidden=\"true\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><path fill=\"currentColor\" d=\"M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.3 288 480 288c17.7 0 32-14.3 32-32s-14.3-32-32-32l-370.7 0 105.4-105.4c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z\"/></svg></span>All sections",
          "link": "/"
        },
        {
          "text": "<span class=\"mdbook-icon\"><svg class=\"mdbook-icon-svg\" aria-hidden=\"true\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><path fill=\"currentColor\" d=\"M64 448l384 0c35.3 0 64-28.7 64-64l0-240c0-35.3-28.7-64-64-64L298.7 80c-6.9 0-13.7-2.2-19.2-6.4L241.1 44.8C230 36.5 216.5 32 202.7 32L64 32C28.7 32 0 60.7 0 96L0 384c0 35.3 28.7 64 64 64z\"/></svg></span>Docs",
          "items": [
            {
              "text": "TermX Wiki → mdbook: differences reference",
              "link": "/docs/termx-wiki-compatibility"
            }
          ]
        }
      ],
      "/vendor/": [
        {
          "text": "<span class=\"mdbook-icon\"><svg class=\"mdbook-icon-svg\" aria-hidden=\"true\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><path fill=\"currentColor\" d=\"M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.3 288 480 288c17.7 0 32-14.3 32-32s-14.3-32-32-32l-370.7 0 105.4-105.4c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z\"/></svg></span>All sections",
          "link": "/"
        },
        {
          "text": "<span class=\"mdbook-icon\"><svg class=\"mdbook-icon-svg\" aria-hidden=\"true\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><path fill=\"currentColor\" d=\"M64 448l384 0c35.3 0 64-28.7 64-64l0-240c0-35.3-28.7-64-64-64L298.7 80c-6.9 0-13.7-2.2-19.2-6.4L241.1 44.8C230 36.5 216.5 32 202.7 32L64 32C28.7 32 0 60.7 0 96L0 384c0 35.3 28.7 64 64 64z\"/></svg></span>Vendor",
          "items": [
            {
              "text": "<span class=\"mdbook-icon\"><svg class=\"mdbook-icon-svg\" aria-hidden=\"true\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><path fill=\"currentColor\" d=\"M64 448l384 0c35.3 0 64-28.7 64-64l0-240c0-35.3-28.7-64-64-64L298.7 80c-6.9 0-13.7-2.2-19.2-6.4L241.1 44.8C230 36.5 216.5 32 202.7 32L64 32C28.7 32 0 60.7 0 96L0 384c0 35.3 28.7 64 64 64z\"/></svg></span>Vendored: @termx-health/structure-definition-viewer v5.1.0",
              "collapsed": true,
              "items": [],
              "link": "/vendor/structure-definition-viewer/"
            }
          ]
        }
      ],
      "/": [
        {
          "text": "<span class=\"mdbook-icon\"><svg class=\"mdbook-icon-svg\" aria-hidden=\"true\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><path fill=\"currentColor\" d=\"M64 448l384 0c35.3 0 64-28.7 64-64l0-240c0-35.3-28.7-64-64-64L298.7 80c-6.9 0-13.7-2.2-19.2-6.4L241.1 44.8C230 36.5 216.5 32 202.7 32L64 32C28.7 32 0 60.7 0 96L0 384c0 35.3 28.7 64 64 64z\"/></svg></span>Docs",
          "link": "/docs/termx-wiki-compatibility"
        },
        {
          "text": "<span class=\"mdbook-icon\"><svg class=\"mdbook-icon-svg\" aria-hidden=\"true\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><path fill=\"currentColor\" d=\"M64 448l384 0c35.3 0 64-28.7 64-64l0-240c0-35.3-28.7-64-64-64L298.7 80c-6.9 0-13.7-2.2-19.2-6.4L241.1 44.8C230 36.5 216.5 32 202.7 32L64 32C28.7 32 0 60.7 0 96L0 384c0 35.3 28.7 64 64 64z\"/></svg></span>Vendor",
          "link": "/vendor/structure-definition-viewer/"
        }
      ]
    }
  },
  "navs": {
    "en": []
  },
  "userNav": [],
  "userSidebar": null,
  "userSidebarExtra": [],
  "userLocales": null,
  "search": true,
  "comments": null,
  "footer": null,
  "wide": false,
  "openapi": null,
  "web": null,
  "txServer": null,
  "spaceCode": null,
  "pageSlugs": [
    "termx-wiki-compatibility"
  ],
  "logo": null,
  "mdbookDir": "/Users/igor/source/igorboss/mdbook",
  "outDir": "/Users/igor/source/igorboss/mdbook/.mdbook/dist",
  "cleanUrls": true,
  "assetBase": "/attachments",
  "breaks": false
})
