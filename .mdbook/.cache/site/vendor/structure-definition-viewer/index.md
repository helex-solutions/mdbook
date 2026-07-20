---
description: "Self-contained web component () that renders a FHIR StructureDefinition JSON. Vendored from the published GitHub package so mdbook builds need no GitHub…"
breadcrumbs: [{"text":"Home","link":"/"},{"text":"Vendor"},{"text":"Vendored: @termx-health/structure-definition-viewer v5.1.0","link":"/vendor/structure-definition-viewer/"}]
---

# Vendored: @termx-health/structure-definition-viewer v5.1.0

Self-contained web component (`<tx-sd-view>`) that renders a FHIR
StructureDefinition JSON. Vendored from the published GitHub package so mdbook
builds need no GitHub Packages auth in CI.

Source: https://github.com/termx-health/structure-definition-viewer
API: `initializeWebComponent('tx-sd-view')`, then
`<tx-sd-view data="<encodeURIComponent(json)>" mode="diff|snap|hybrid" inline="true">`
