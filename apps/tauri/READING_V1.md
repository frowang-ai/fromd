# Tauri reading tools

The existing page/outline workbar remains in place. The outline now recognizes
ATX, Setext and quoted headings, excludes fenced code and the existing leading
YAML metadata block, and uses original UTF-16 source offsets through EditorPort.
Repeated headings retain separate entries. Navigation waits for composition and
the coordinator's document ownership, then checks the current body again.

The floating name/save dock also shows word and non-whitespace character counts.
Han, kana and Hangul are counted character by character; other word-like segments
(including English and numbers) use `Intl.Segmenter`. Character counts use Unicode
codepoints, not UTF-16 units or grapheme clusters. Code and formula source are
included; Markdown delimiters, URLs, hidden comments and leading YAML metadata are
excluded. Counts and outline updates are debounced by 180 ms and cleared on page
changes. The analysis parser does not typographically rewrite punctuation or
change the shared preview/PDF renderer.

Use the header's 阅读 button, View > 阅读设置… or Ctrl+, for font size
14/16/18/20 px, text width 720/860/900/1080 px and light/dark/system appearance.
Defaults retain the existing Tauri body: 16 px, 860 px, light. Source text follows
the selected size/width; the viewport constrains both modes on narrow windows.
The existing sidebar layout is unchanged. Reading settings and Find/Replace use
separate, mutually exclusive overlays.

Only validated settings are stored under `frowd.tauri.reading-preferences.v1` in
this application's localStorage. Missing or invalid fields use defaults. Read or
write failures are visible in the settings panel; a write failure keeps the new
selection usable for the current window. No document, path, native preference or
database schema is written by changing reading preferences.

Dark appearance covers the shell, page workbar, menus, PM text, code and formula
editing. The code highlighters use CSS variables with their previous light colors
as fallbacks. Page collapse takes its paper/backdrop colors from the active theme;
its timing and navigation behavior are unchanged. Reading CSS is screen-only and
does not change print styling or a separately generated PDF. Native titlebar/menu
appearance is still managed by the host/OS.

Validation uses `apps/tauri/tests/reading.test.mjs` and
`apps/tauri/tests/reading.browser.spec.mjs`. Browser tests use synthetic content
and the mock IPC host. They verify outline navigation in both modes, live counts,
settings reload/failure, code/formula contrast, system-theme changes, print CSS
and narrow-window controls. Native WebView2 persistence, physical IME and native
PDF behavior require the main integration's separate native checks.
