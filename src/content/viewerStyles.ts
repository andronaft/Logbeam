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

[hidden] { display: none !important; }
.group { display: inline-flex; gap: 2px; margin: 0 4px; }
.search {
  width: 240px; font: 12.5px ui-monospace, Menlo, Consolas, monospace; color: var(--fg);
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
.match { background: #6b5a1e; color: #fff; border-radius: 2px; }
.secret { background: rgba(255, 107, 107, .22); outline: 1px dashed var(--error); border-radius: 2px; }
.row.has-secret .ln::before { content: "🔑"; font-size: 10px; margin-right: 4px; }
.row { cursor: default; }
.row.selected, .row.selected .ln { background: #243040 !important; }
.ln { cursor: pointer; }
.ln:hover { color: var(--accent); text-decoration: underline; }
.toggle.secrets { color: var(--error); border-color: rgba(255,107,107,.5); }

.loading { margin: auto; width: min(420px, 80vw); display: flex; flex-direction: column; gap: 10px; }
.loading-label { color: var(--muted); font-variant-numeric: tabular-nums; }
.progress { height: 6px; background: var(--panel); border-radius: 3px; overflow: hidden; }
.progress-bar { height: 100%; width: 0; background: var(--accent); transition: width .1s; }

.timeline {
  display: flex; align-items: flex-end; gap: 1px; height: 44px; padding: 4px 12px;
  background: var(--bg-alt); border-bottom: 1px solid var(--border);
}
.bucket {
  flex: 1; height: 100%; padding: 0; border: none; border-radius: 0; background: none;
  display: flex; flex-direction: column-reverse; justify-content: flex-start; min-width: 2px;
}
.bucket:hover { background: var(--panel); }
.bucket span { display: block; width: 100%; }
.b-err { background: var(--error); }
.b-warn { background: var(--warn); }
.b-other { background: #3a4550; }

.inspector {
  max-height: 40vh; overflow: auto; border-top: 2px solid var(--accent); background: var(--panel); padding: 8px 12px;
}
.inspector-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.facts { flex: 1; color: var(--muted); }
.facts .lvl-ERROR { color: var(--error); } .facts .lvl-WARN { color: var(--warn); }
.facts .lvl-INFO { color: var(--info); } .facts .lvl-DEBUG { color: var(--debug); }
.secret-note { color: var(--error); }
.full-text, .json {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font: 12.5px/1.5 ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
}
.json { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); color: var(--debug); }

.toast {
  position: fixed; bottom: 20px; left: 50%; transform: translate(-50%, 20px); opacity: 0; pointer-events: none;
  background: var(--accent); color: var(--bg); font-weight: 600; padding: 6px 14px; border-radius: 6px; transition: .2s;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.repeat {
  display: inline-block; margin-right: 8px; padding: 0 6px; border-radius: 8px;
  background: var(--panel); color: var(--accent); font-size: 11px; line-height: 16px;
}

.subbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 5px 12px; background: var(--bg-alt); border-bottom: 1px solid var(--border);
}
.search.fields { border-color: var(--info); color: var(--info); }
.range { color: var(--accent); }
.bucket.dragging { background: #3a2f1c; }
.bucket.outside { opacity: .3; }

/* pinned highlights */
.hl { color: #0f1419; border-radius: 2px; }
.hl-0 { background: #ffd866; } .hl-1 { background: #78dce8; } .hl-2 { background: #a9dc76; }
.hl-3 { background: #fc9867; } .hl-4 { background: #ab9df2; }
.hl-chip { color: #0f1419; border-color: transparent; font-weight: 600; }

/* pods and containers */
.sources .chip { opacity: .4; font: 12px ui-monospace, Menlo, Consolas, monospace; }
.sources .chip.on { opacity: 1; }
.src-0 { color: #59c2ff; } .src-1 { color: #aad94c; } .src-2 { color: #f29668; } .src-3 { color: #d2a6ff; }
.src-4 { color: #95e6cb; } .src-5 { color: #ffb454; } .src-6 { color: #f07178; } .src-7 { color: #e6b673; }
.txt .src { font-weight: 600; }

.drop-hint {
  position: fixed; inset: 12px; display: none; align-items: center; justify-content: center;
  border: 2px dashed var(--accent); border-radius: 12px; background: rgba(15, 20, 25, .85);
  color: var(--accent); font-size: 18px; font-weight: 600; pointer-events: none; z-index: 10;
}
.drop-hint.show { display: flex; }
`;
