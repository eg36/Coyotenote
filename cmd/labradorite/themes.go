package main

type palette struct{ surface, chrome, text, muted, accent, cyan, good, warn, danger, line, pink, blue, onPill string }

type themeSpec struct {
	id, name string
	light    bool
	colors   palette
}

// Palettes are mapped to application roles; sources are linked in README.md.
// Preserve dark/light IDs so existing settings keep working.
// Labradorite palettes use neutral web surfaces and blue accents; named upstream palettes are unchanged.
var themes = []themeSpec{
	{"dark", "Labradorite Dark", false, palette{"#212121", "#181818", "#ECECEC", "#ABABAB", "#76B9ED", "#8BC8F3", "#8EC49A", "#D4B778", "#F28B82", "#424242", "#8EBDE8", "#76B9ED", "#15202B"}},
	{"light", "Labradorite Light", true, palette{"#FFFFFF", "#F7F5F4", "#202123", "#63666B", "#2374AB", "#176D9C", "#397C58", "#916419", "#B54040", "#D9DDE3", "#347BA9", "#236EA0", "#FFFFFF"}},
	{"ayu-dark", "Ayu Dark", false, palette{"#10141C", "#0D1017", "#BFBDB6", "#92959C", "#E6B450", "#95E6CB", "#AAD94C", "#FFB454", "#F07178", "#273747", "#D2A6FF", "#59C2FF", "#0B0E14"}},
	{"ayu-mirage", "Ayu Mirage", false, palette{"#242936", "#1F2430", "#CCCAC2", "#959CA9", "#FFCC66", "#95E6CB", "#D5FF80", "#FFD173", "#F28779", "#3D4A66", "#DFBFFF", "#73D0FF", "#1F2430"}},
	{"ayu-light", "Ayu Light", true, palette{"#FCFCFC", "#F3F4F5", "#5C6166", "#707A85", "#A66700", "#167D7F", "#527A00", "#976000", "#C43D37", "#CFD8E3", "#8959A8", "#1674A5", "#FFFFFF"}},
	{"catppuccin-mocha", "Catppuccin Mocha", false, palette{"#1E1E2E", "#181825", "#CDD6F4", "#A6ADC8", "#CBA6F7", "#89DCEB", "#A6E3A1", "#F9E2AF", "#F38BA8", "#45475A", "#F5C2E7", "#89B4FA", "#11111B"}},
	{"catppuccin-macchiato", "Catppuccin Macchiato", false, palette{"#24273A", "#1E2030", "#CAD3F5", "#A5ADCB", "#C6A0F6", "#91D7E3", "#A6DA95", "#EED49F", "#ED8796", "#494D64", "#F5BDE6", "#8AADF4", "#181926"}},
	{"catppuccin-frappe", "Catppuccin Frappé", false, palette{"#303446", "#292C3C", "#C6D0F5", "#A5ADCE", "#CA9EE6", "#99D1DB", "#A6D189", "#E5C890", "#E78284", "#51576D", "#F4B8E4", "#8CAAEE", "#232634"}},
	{"catppuccin-latte", "Catppuccin Latte", true, palette{"#EFF1F5", "#E6E9EF", "#4C4F69", "#6C6F85", "#8839EF", "#187C86", "#347F22", "#99600C", "#D20F39", "#BCC0CC", "#A84391", "#1E66F5", "#FFFFFF"}},
	{"nord", "Nord", false, palette{"#2E3440", "#3B4252", "#ECEFF4", "#B8C2D4", "#B48EAD", "#88C0D0", "#A3BE8C", "#EBCB8B", "#BF616A", "#4C566A", "#B48EAD", "#81A1C1", "#2E3440"}},
	{"tokyo-night", "Tokyo Night", false, palette{"#1A1B26", "#16161E", "#C0CAF5", "#A9B1D6", "#BB9AF7", "#7DCFFF", "#9ECE6A", "#E0AF68", "#F7768E", "#3B4261", "#BB9AF7", "#7AA2F7", "#1A1B26"}},
	{"dracula", "Dracula", false, palette{"#282A36", "#21222C", "#F8F8F2", "#A9B2D0", "#BD93F9", "#8BE9FD", "#50FA7B", "#F1FA8C", "#FF5555", "#44475A", "#FF79C6", "#8BE9FD", "#282A36"}},
	{"gruvbox-dark", "Gruvbox Dark", false, palette{"#282828", "#1D2021", "#EBDBB2", "#BDAE93", "#D3869B", "#8EC07C", "#B8BB26", "#FABD2F", "#FB4934", "#504945", "#D3869B", "#83A598", "#282828"}},
	{"gruvbox-light", "Gruvbox Light", true, palette{"#FBF1C7", "#EBDBB2", "#3C3836", "#665C54", "#8F3F71", "#427B58", "#797400", "#925600", "#9D0006", "#D5C4A1", "#8F3F71", "#076678", "#FBF1C7"}},
}

func themeByID(id string) themeSpec {
	for _, t := range themes {
		if t.id == id {
			return t
		}
	}
	return themes[0]
}
func validTheme(id string) bool    { return themeByID(id).id == id }
func themeIsLight(id string) bool  { return themeByID(id).light }
func paletteFor(id string) palette { return themeByID(id).colors }
