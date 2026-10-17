# Third-party notices

## Editor component

`internal/editor/textarea.go` is adapted from
[Charmbracelet Bubbles textarea v0.21.0](https://github.com/charmbracelet/bubbles/tree/v0.21.0/textarea).
Local changes add source-based selection rendering and cursor/viewport handling.
Its upstream license follows and is also retained in `internal/editor/LICENSE`.

MIT License

Copyright (c) 2020-2023 Charmbracelet, Inc

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Theme palettes

Theme colors are adapted to application UI roles from the original projects:

- Ayu — https://github.com/ayu-theme/ayu-colors
- Catppuccin — https://catppuccin.com/palette/
- Nord — https://www.nordtheme.com/docs/colors-and-palettes/
- Tokyo Night — https://github.com/folke/tokyonight.nvim
- Dracula — https://github.com/dracula/dracula-theme
- Gruvbox — https://github.com/morhetz/gruvbox

These themes are community adaptations; they do not imply endorsement by their
original authors. The existing Go module dependencies retain their own licenses.
