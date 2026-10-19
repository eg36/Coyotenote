// Package web holds the browser frontend that the web app embeds: the page,
// the committed asset bundle built by `npm run build`, and the logo.
package web

import "embed"

//go:embed index.html assets/* logo.png
var Files embed.FS
