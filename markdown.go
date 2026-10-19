package main

import (
	"html"
	"regexp"
)

var imageTag = regexp.MustCompile(`<img\b[^>]*alt="([^"]*)"[^>]*>`)

func suppressImages(text string) string {
	return imageTag.ReplaceAllStringFunc(text, func(tag string) string {
		match := imageTag.FindStringSubmatch(tag)
		return `<span class="image-placeholder">[image: ` + html.EscapeString(html.UnescapeString(match[1])) + `]</span>`
	})
}
