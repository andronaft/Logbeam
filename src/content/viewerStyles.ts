export const VIEWER_CSS = `
:root {
  color-scheme: dark;
  --bg: #0f1419; --bg-alt: #151c23; --panel: #1a222b; --border: #2d3640;
  --fg: #e6e1cf; --muted: #6c7680; --accent: #ffb454;
  --error: #ff6b6b; --warn: #ffb454; --info: #59c2ff; --debug: #95e6cb; --trace: #8a9199;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg); }
body { display: flex; flex-direction: column; font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }

.toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 8px 12px; background: var(--panel); border-bottom: 1px solid var(--border);
}
.brand { color: var(--accent); font-weight: 700; margin-right: 6px; }
button {
  font: inherit; color: var(--fg); background: var(--bg-alt); cursor: pointer;
  border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px;
}
button:hover { border-color: var(--accent); }
.toggle.on { background: #3a2f1c; border-color: var(--accent); }
.chip { opacity: .45; }
.chip.on { opacity: 1; }
.chip .count { color: var(--muted); font-variant-numeric: tabular-nums; }
.chip.lvl-ERROR { color: var(--error); }
.chip.lvl-WARN { color: var(--warn); }
.chip.lvl-INFO { color: var(--info); }
.chip.lvl-DEBUG { color: var(--debug); }
.chip.lvl-TRACE { color: var(--trace); }

.search-box { display: inline-flex; gap: 2px; margin: 0 6px; }
.search {
  width: 220px; font: 12.5px ui-monospace, Menlo, Consolas, monospace; color: var(--fg);
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px;
}
.search:focus { outline: none; border-color: var(--accent); }
.search.invalid { border-color: var(--error); }
.status { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }

.scroller { flex: 1; overflow: auto; position: relative; outline: none; }
.spacer { width: 1px; }
.rows { position: absolute; top: 0; left: 0; min-width: 100%; will-change: transform; }
.row {
  height: 20px; line-height: 20px; white-space: pre; display: flex;
  font: 12.5px/20px ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
}
.row:hover { background: var(--bg-alt); }
.ln {
  flex: none; width: 64px; padding-right: 10px; text-align: right; color: var(--muted);
  user-select: none; position: sticky; left: 0; background: var(--bg);
}
.gap { flex: none; width: 64px; color: var(--muted); font-size: 11px; user-select: none; }
.gap.big { color: var(--warn); font-weight: 600; }
.txt { padding-right: 24px; }
.row.lvl-ERROR .txt { color: var(--error); }
.row.lvl-ERROR { background: rgba(255, 107, 107, .06); }
.row.lvl-WARN .txt { color: var(--warn); }
.row.lvl-INFO .txt { color: var(--fg); }
.row.lvl-DEBUG .txt { color: var(--debug); opacity: .85; }
.row.lvl-TRACE .txt { color: var(--trace); }
.row.cont .txt { opacity: .75; }
mark { background: #6b5a1e; color: #fff; border-radius: 2px; }
.repeat {
  display: inline-block; margin-right: 8px; padding: 0 6px; border-radius: 8px;
  background: var(--panel); color: var(--accent); font-size: 11px; line-height: 16px;
}
`;
