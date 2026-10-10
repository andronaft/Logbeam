export const VIEWER_CSS = `
:root {
  color-scheme: dark;
  --bg: #0f1419; --bg-alt: #151c23; --panel: #1a222b; --border: #2d3640;
  --fg: #e6e1cf; --muted: #6c7680; --accent: #ffb454;
  --error: #ff6b6b; --warn: #ffb454; --info: #59c2ff; --debug: #95e6cb; --trace: #8a9199;
  --on: #3a2f1c; --error-row: rgba(255, 107, 107, .06); --secret-bg: rgba(255, 107, 107, .22);
  --match-bg: #6b5a1e; --match-fg: #fff; --selected: #243040; --bar-other: #3a4550; --overlay: rgba(15, 20, 25, .85);
  --src-0: #59c2ff; --src-1: #aad94c; --src-2: #f29668; --src-3: #d2a6ff;
  --src-4: #95e6cb; --src-5: #ffb454; --src-6: #f07178; --src-7: #e6b673;
  --ansi-black: #6c7680; --ansi-red: #ff6b6b; --ansi-green: #aad94c; --ansi-yellow: #ffd866; --ansi-blue: #59c2ff;
  --ansi-magenta: #d2a6ff; --ansi-cyan: #95e6cb; --ansi-white: #e6e1cf;
  --ansi-bright-black: #8a9199; --ansi-bright-red: #ff8f8f; --ansi-bright-green: #c2e88b; --ansi-bright-yellow: #ffe599;
  --ansi-bright-blue: #8fd4ff; --ansi-bright-magenta: #e3c6ff; --ansi-bright-cyan: #b8f0dd; --ansi-bright-white: #ffffff;
}
/* light: when the system is light (unless Settings say dark), or when Settings say light */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    color-scheme: light;
    --bg: #ffffff; --bg-alt: #f5f6f7; --panel: #eef0f2; --border: #d5d9de;
    --fg: #1f2328; --muted: #6b7280; --accent: #b25e00;
    --error: #c62828; --warn: #a15c00; --info: #0b62b8; --debug: #2e7d6b; --trace: #6b7280;
    --on: #fde7c7; --error-row: rgba(198, 40, 40, .06); --secret-bg: rgba(198, 40, 40, .14);
    --match-bg: #ffe08a; --match-fg: #1f2328; --selected: #dbe9fb; --bar-other: #c4cad1; --overlay: rgba(255, 255, 255, .88);
    --src-0: #0b62b8; --src-1: #4f7a12; --src-2: #b4501f; --src-3: #7b3fc4;
    --src-4: #1f7a68; --src-5: #a15c00; --src-6: #b42339; --src-7: #8a6416;
    --ansi-black: #1f2328; --ansi-red: #c62828; --ansi-green: #2e7d32; --ansi-yellow: #8a6d00; --ansi-blue: #0b62b8;
    --ansi-magenta: #8e24aa; --ansi-cyan: #00796b; --ansi-white: #6b7280;
    --ansi-bright-black: #6b7280; --ansi-bright-red: #e53935; --ansi-bright-green: #43a047; --ansi-bright-yellow: #a07c00;
    --ansi-bright-blue: #1e88e5; --ansi-bright-magenta: #ab47bc; --ansi-bright-cyan: #00897b; --ansi-bright-white: #374151;
  }
}
:root[data-theme="light"] {
    color-scheme: light;
    --bg: #ffffff; --bg-alt: #f5f6f7; --panel: #eef0f2; --border: #d5d9de;
    --fg: #1f2328; --muted: #6b7280; --accent: #b25e00;
    --error: #c62828; --warn: #a15c00; --info: #0b62b8; --debug: #2e7d6b; --trace: #6b7280;
    --on: #fde7c7; --error-row: rgba(198, 40, 40, .06); --secret-bg: rgba(198, 40, 40, .14);
    --match-bg: #ffe08a; --match-fg: #1f2328; --selected: #dbe9fb; --bar-other: #c4cad1; --overlay: rgba(255, 255, 255, .88);
    --src-0: #0b62b8; --src-1: #4f7a12; --src-2: #b4501f; --src-3: #7b3fc4;
    --src-4: #1f7a68; --src-5: #a15c00; --src-6: #b42339; --src-7: #8a6416;
    --ansi-black: #1f2328; --ansi-red: #c62828; --ansi-green: #2e7d32; --ansi-yellow: #8a6d00; --ansi-blue: #0b62b8;
    --ansi-magenta: #8e24aa; --ansi-cyan: #00796b; --ansi-white: #6b7280;
    --ansi-bright-black: #6b7280; --ansi-bright-red: #e53935; --ansi-bright-green: #43a047; --ansi-bright-yellow: #a07c00;
    --ansi-bright-blue: #1e88e5; --ansi-bright-magenta: #ab47bc; --ansi-bright-cyan: #00897b; --ansi-bright-white: #374151;
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
.toggle.on { background: var(--on); border-color: var(--accent); }
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
.row.lvl-ERROR { background: var(--error-row); }
.row.lvl-WARN .txt { color: var(--warn); }
.row.lvl-INFO .txt { color: var(--fg); }
.row.lvl-DEBUG .txt { color: var(--debug); opacity: .85; }
.row.lvl-TRACE .txt { color: var(--trace); }
.row.cont .txt { opacity: .75; }
.match { background: var(--match-bg); color: var(--match-fg); border-radius: 2px; }
.secret { background: var(--secret-bg); outline: 1px dashed var(--error); border-radius: 2px; }
.row.has-secret .ln::before { content: "🔑"; font-size: 10px; margin-right: 4px; }
.row { cursor: default; }
.row.selected, .row.selected .ln { background: var(--selected) !important; }
.ln { cursor: pointer; }
.ln:hover { color: var(--accent); text-decoration: underline; }
.toggle.secrets { color: var(--error); border-color: var(--error); }

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
.b-other { background: var(--bar-other); }

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
.bucket.dragging { background: var(--on); }
.bucket.outside { opacity: .3; }

/* pinned highlights */
.hl { color: #0f1419; border-radius: 2px; }
.hl-0 { background: #ffd866; } .hl-1 { background: #78dce8; } .hl-2 { background: #a9dc76; }
.hl-3 { background: #fc9867; } .hl-4 { background: #ab9df2; }
.hl-chip { color: #0f1419; border-color: transparent; font-weight: 600; }

/* pods and containers */
.sources .chip { opacity: .4; font: 12px ui-monospace, Menlo, Consolas, monospace; }
.sources .chip.on { opacity: 1; }
.src-0 { color: var(--src-0); } .src-1 { color: var(--src-1); } .src-2 { color: var(--src-2); } .src-3 { color: var(--src-3); }
.src-4 { color: var(--src-4); } .src-5 { color: var(--src-5); } .src-6 { color: var(--src-6); } .src-7 { color: var(--src-7); }
.txt .src { font-weight: 600; }

.drop-hint {
  position: fixed; inset: 12px; display: none; align-items: center; justify-content: center;
  border: 2px dashed var(--accent); border-radius: 12px; background: var(--overlay);
  color: var(--accent); font-size: 18px; font-weight: 600; pointer-events: none; z-index: 10;
}
.drop-hint.show { display: flex; }

/* bookmarks */
.row.bookmarked .ln { color: var(--accent); }
.row.bookmarked .ln::after { content: " ★"; }
.bookmarks { color: var(--accent); }
.inspector .note {
  width: 100%; margin: 6px 0 0; padding: 4px 8px; font: inherit; color: var(--fg);
  background: var(--bg); border: 1px solid var(--accent); border-radius: 6px;
}

/* field statistics */
.fields { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 8px; }
.field { font: 12px ui-monospace, Menlo, Consolas, monospace; padding: 1px 7px; }
.stats { margin-top: 6px; display: grid; gap: 2px; max-width: 720px; }
.stats-head { color: var(--muted); margin-bottom: 2px; }
.stat {
  display: grid; grid-template-columns: minmax(80px, 260px) 1fr 70px; gap: 8px; align-items: center;
  text-align: left; padding: 1px 6px; font: 12px ui-monospace, Menlo, Consolas, monospace;
}
.stat .value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stat .bar-wrap { height: 8px; background: var(--bg); border-radius: 4px; overflow: hidden; }
.stat .bar { display: block; height: 100%; background: var(--info); }
.stat .n { color: var(--muted); text-align: right; }

/* error groups */
.groups {
  max-height: 30vh; overflow: auto; padding: 6px 12px; background: var(--bg-alt);
  border-bottom: 1px solid var(--border); display: grid; gap: 2px;
}
.groups-head { color: var(--muted); margin-bottom: 4px; }
.group-item {
  display: grid; grid-template-columns: 56px 1fr auto; gap: 10px; text-align: left; padding: 2px 8px;
  font: 12px ui-monospace, Menlo, Consolas, monospace;
}
.group-item .n { color: var(--error); font-weight: 700; }
.group-item .sample { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--error); }
.group-item .meta { color: var(--muted); white-space: nowrap; }
.group-chip { color: var(--error); max-width: 50vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* JSON table */
.txt.table { display: inline-flex; gap: 0; }
.txt.table .cell {
  display: inline-block; width: 180px; padding-right: 12px; overflow: hidden; text-overflow: ellipsis; flex: none;
}
.txt.table .cell:nth-child(2) { width: 70px; }
.txt.table .rest { color: var(--muted); }
.columns-label { color: var(--muted); }
.columns {
  width: 320px; font: 12px ui-monospace, Menlo, Consolas, monospace; color: var(--fg);
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 2px 6px;
}

/* colours from ANSI escape codes */
.ansi-black { color: var(--ansi-black); }
.ansi-red { color: var(--ansi-red); }
.ansi-green { color: var(--ansi-green); }
.ansi-yellow { color: var(--ansi-yellow); }
.ansi-blue { color: var(--ansi-blue); }
.ansi-magenta { color: var(--ansi-magenta); }
.ansi-cyan { color: var(--ansi-cyan); }
.ansi-white { color: var(--ansi-white); }
.ansi-bright-black { color: var(--ansi-bright-black); }
.ansi-bright-red { color: var(--ansi-bright-red); }
.ansi-bright-green { color: var(--ansi-bright-green); }
.ansi-bright-yellow { color: var(--ansi-bright-yellow); }
.ansi-bright-blue { color: var(--ansi-bright-blue); }
.ansi-bright-magenta { color: var(--ansi-bright-magenta); }
.ansi-bright-cyan { color: var(--ansi-bright-cyan); }
.ansi-bright-white { color: var(--ansi-bright-white); }
.ansi-bold { font-weight: 700; } .ansi-dim { opacity: .7; } .ansi-italic { font-style: italic; }
.ansi-underline { text-decoration: underline; }
`;
