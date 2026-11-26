'use strict';
/* 10xEngineers EDA — Excel viewer: opens .xlsx files (test plans, coverage workbooks, anything) in a read-only VS Code tab.
 * Registered as a custom editor (priority "option": it never takes .xlsx away from another viewer you prefer);
 * test plans open in it from the DV commands, and any .xlsx via right-click → Open With… / "Excel: View in VS Code". */
const fs = require('fs');
const path = require('path');
const { readXlsx, pathLinks } = require('./xlsxread');

function register(context, h) {
  const vscode = require('vscode');
  const sub = d => context.subscriptions.push(d);
  const media = vscode.Uri.joinPath(context.extensionUri, 'media');

  class Provider {
    openCustomDocument(uri) { return { uri, dispose() {} }; }
    async resolveCustomEditor(doc, panel) {
      panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
      const n = h.nonce();
      const js = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'xlsxview.js'));
      const css = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'xlsxview.css'));
      panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${h.csp(panel.webview, n)}">
<link rel="stylesheet" href="${css}"><title>Excel</title></head><body>
<header><span class="brand">10xEngineers EDA · Excel</span><span id="file"></span><span class="grow"></span>
<input id="q" type="search" placeholder="Search this sheet  ( / )"><span id="count"></span>
<button id="bCopy" title="Copy the visible rows as tab-separated text (pastes into Excel / Sheets)">Copy</button>
<button id="bReveal" title="Show the file in the file explorer">Reveal</button>
<button id="bExcel" class="primary" title="Open in Excel / the system spreadsheet app">Open in Excel</button></header>
<nav id="tabs"></nav><main id="main"><div class="empty">Loading…</div></main>
<script nonce="${n}" src="${js}"></script></body></html>`;
      const post = m => panel.webview.postMessage(m);
      const load = () => {
        try {
          const data = readXlsx(fs.readFileSync(doc.uri.fsPath));
          // mark cells that are paths of existing files/folders, so the viewer can link them
          const links = pathLinks(data, p => fs.existsSync(p));
          post({ type: 'data', file: path.basename(doc.uri.fsPath), data, links });
        } catch (e) { post({ type: 'error', message: String(e && e.message || e) }); }
      };
      const subs = [];
      subs.push(panel.webview.onDidReceiveMessage(async m => {
        if (m.type === 'ready') load();
        if (m.type === 'excel') vscode.env.openExternal(doc.uri);
        if (m.type === 'reveal') vscode.commands.executeCommand('revealFileInOS', doc.uri);
        if (m.type === 'open' && m.path && fs.existsSync(m.path)) {
          if (fs.statSync(m.path).isDirectory()) vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(m.path));
          else if (/\.(html?)$/i.test(m.path)) vscode.env.openExternal(vscode.Uri.file(m.path));
          else vscode.commands.executeCommand('vscode.open', vscode.Uri.file(m.path), vscode.ViewColumn.Beside);
        }
        if (m.type === 'copy') { await vscode.env.clipboard.writeText(m.text); vscode.window.setStatusBarMessage(`Copied ${m.rows} row(s)`, 2500); }
      }));
      // a run rewrites testplan.xlsx: follow it
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(doc.uri.fsPath)), path.basename(doc.uri.fsPath)));
      let t;
      const again = () => { clearTimeout(t); t = setTimeout(load, 400); };
      subs.push(w, w.onDidChange(again), w.onDidCreate(again));
      panel.onDidDispose(() => subs.forEach(s => s.dispose()));
    }
  }

  sub(vscode.window.registerCustomEditorProvider('tenxDebug.xlsxViewer', new Provider(), { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }));
  const view = uri => vscode.commands.executeCommand('vscode.openWith', uri, 'tenxDebug.xlsxViewer');
  sub(vscode.commands.registerCommand('tenxDebug.xlsx.view', async uri => {
    if (!(uri instanceof vscode.Uri)) {
      const ed = vscode.window.activeTextEditor;
      const pick = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Excel: ['xlsx', 'xlsm'] }, defaultUri: ed ? vscode.Uri.file(path.dirname(ed.document.uri.fsPath)) : undefined, openLabel: 'View' });
      if (!pick || !pick.length) return;
      uri = pick[0];
    }
    view(uri);
  }));
  sub(vscode.commands.registerCommand('tenxDebug.dv.viewTestPlan', async () => {
    const found = await vscode.workspace.findFiles('**/testplan.xlsx', '**/{node_modules,.git,.dvflow}/**', 50);
    if (!found.length) { vscode.window.showWarningMessage('No testplan.xlsx in the workspace yet. Run DV: Generate Test Plan (or a regression) first.'); return; }
    const u = found.length === 1 ? found[0] : (await vscode.window.showQuickPick(found.map(f => ({ label: vscode.workspace.asRelativePath(f), f })), { placeHolder: 'Test plan' }) || {}).f;
    if (u) view(u);
  }));
  return { view };
}

module.exports = { register };
