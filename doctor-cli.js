const path = require('path');
const fs = require('fs');

function getDataRoot() {
    return path.join(process.cwd(), 'data', 'default-user');
}

function relPath(fullPath) {
    return path.relative(path.join(process.cwd(), 'data'), fullPath);
}

function fmtBytes(b) {
    if (b === 0) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
}

function hasBOM(buf) {
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'UTF-8 BOM';
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return 'UTF-16 LE BOM';
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return 'UTF-16 BE BOM';
    return null;
}

function hasNullBytes(buf) {
    for (let i = 0; i < Math.min(buf.length, 8192); i++) {
        if (buf[i] === 0x00) return true;
    }
    return false;
}

function baseChecks(fp, rp, cat) {
    const issues = [];
    try {
        const stat = fs.statSync(fp);
        if (stat.size === 0) {
            issues.push({ path: rp, category: cat, severity: 'critical', error: '檔案為空 (0 bytes)', size: 0, suggestion: '此檔案完全為空，無法被酒館讀取。建議刪除。' });
            return issues;
        }
        if (stat.size > 50 * 1024 * 1024) {
            issues.push({ path: rp, category: cat, severity: 'warning', error: `檔案異常大 (${fmtBytes(stat.size)})`, size: stat.size, suggestion: '超過 50MB，可能導致載入緩慢。' });
        }
        const fd = fs.openSync(fp, 'r');
        const buf = Buffer.alloc(Math.min(stat.size, 8192));
        fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        const bom = hasBOM(buf);
        if (bom) issues.push({ path: rp, category: cat, severity: 'warning', error: `偵測到 ${bom}`, size: stat.size, suggestion: 'BOM 標記可能導致 JSON 解析失敗。' });
        if (hasNullBytes(buf)) issues.push({ path: rp, category: cat, severity: 'warning', error: '偵測到 NULL 字元', size: stat.size, suggestion: '可能表示編碼錯誤或檔案損壞。' });
    } catch (err) {
        issues.push({ path: rp, category: cat, severity: 'critical', error: `無法讀取: ${err.message}`, size: 0, suggestion: '檔案可能已損壞或權限不足。' });
    }
    return issues;
}

function scanJson(fp, rp, cat, reqFields) {
    const issues = baseChecks(fp, rp, cat);
    if (issues.some(i => i.severity === 'critical')) return issues;
    try {
        const stat = fs.statSync(fp);
        const raw = fs.readFileSync(fp, 'utf-8').replace(/^\uFEFF/, '');
        try {
            const obj = JSON.parse(raw);
            for (const f of (reqFields || [])) {
                if (obj[f] === undefined || obj[f] === null) {
                    issues.push({ path: rp, category: cat, severity: 'warning', error: `缺少必要欄位: ${f}`, size: stat.size, suggestion: `缺少 "${f}" 欄位，可能導致功能異常。` });
                }
            }
        } catch (pe) {
            issues.push({ path: rp, category: cat, severity: 'critical', error: `JSON 解析失敗: ${pe.message.substring(0, 100)}`, size: stat.size, suggestion: '格式錯誤，無法正確載入。' });
        }
    } catch (_) {}
    return issues;
}

function scanJsonl(fp, rp, cat) {
    const issues = baseChecks(fp, rp, cat);
    if (issues.some(i => i.severity === 'critical')) return issues;
    try {
        const stat = fs.statSync(fp);
        const lines = fs.readFileSync(fp, 'utf-8').replace(/^\uFEFF/, '').split('\n');
        let emptyCount = 0, errFound = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) { emptyCount++; continue; }
            try { JSON.parse(line); } catch (pe) {
                if (!errFound) {
                    issues.push({ path: rp, category: cat, severity: 'critical', error: `第 ${i + 1} 行 JSON 解析失敗`, size: stat.size, suggestion: `此聊天紀錄在第 ${i + 1} 行損壞。建議刪除或手動修復。` });
                    errFound = true;
                }
            }
        }
    } catch (_) {}
    return issues;
}

function walkDir(dir, ext, cat, fn, reqFields) {
    const r = { total: 0, issues: [] };
    if (!fs.existsSync(dir)) return r;
    (function walk(d) {
        let ents;
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
        for (const e of ents) {
            const fp = path.join(d, e.name);
            if (e.isDirectory()) walk(fp);
            else if (e.name.endsWith(ext)) {
                r.total++;
                r.issues.push(...fn(fp, relPath(fp), cat, reqFields));
            }
        }
    })(dir);
    return r;
}

function fullScan() {
    const dr = getDataRoot();
    if (!fs.existsSync(dr)) {
        console.error("❌ 找不到資料目錄：", dr);
        console.error("請確保你在 SillyTavern 的根目錄執行此腳本！");
        process.exit(1);
    }

    const cats = [];
    let totalFiles = 0, crit = 0, warn = 0, inf = 0;

    const configs = [
        { type: 'chats', name: '個人聊天紀錄', icon: '💬', dir: path.join(dr, 'chats'), ext: '.jsonl', fn: scanJsonl, req: [] },
        { type: 'group_chats', name: '群組聊天紀錄', icon: '👥', dir: path.join(dr, 'group chats'), ext: '.jsonl', fn: scanJsonl, req: [] },
        { type: 'characters', name: '角色卡', icon: '🎭', dir: path.join(dr, 'characters'), ext: '.json', fn: scanJson, req: ['name'] },
        { type: 'worlds', name: '世界書', icon: '🌍', dir: path.join(dr, 'worlds'), ext: '.json', fn: scanJson, req: ['entries'] },
        { type: 'groups', name: '群組設定', icon: '📁', dir: path.join(dr, 'groups'), ext: '.json', fn: scanJson, req: ['members'] },
        { type: 'themes', name: '主題', icon: '🎨', dir: path.join(dr, 'themes'), ext: '.json', fn: scanJson, req: [] },
        { type: 'vectors', name: '向量資料', icon: '🔢', dir: path.join(dr, 'vectors'), ext: '.json', fn: scanJson, req: [] },
    ];

    const sp = path.join(dr, 'settings.json');
    if (fs.existsSync(sp)) {
        totalFiles++;
        const si = scanJson(sp, relPath(sp), '使用者設定');
        si.forEach(i => { if (i.severity === 'critical') crit++; else if (i.severity === 'warning') warn++; else inf++; });
        cats.push({ name: '使用者設定', icon: '🔧', total: 1, issues: si });
    }

    for (const c of configs) {
        const r = walkDir(c.dir, c.ext, c.name, c.fn, c.req);
        totalFiles += r.total;
        r.issues.forEach(i => { if (i.severity === 'critical') crit++; else if (i.severity === 'warning') warn++; else inf++; });
        cats.push({ name: c.name, icon: c.icon, total: r.total, issues: r.issues });
    }

    const cp = path.join(process.cwd(), 'config.yaml');
    if (fs.existsSync(cp)) {
        totalFiles++;
        const ci = [];
        try {
            const st = fs.statSync(cp);
            if (st.size === 0) { ci.push({ path: 'config.yaml', category: '系統設定', severity: 'critical', error: 'config.yaml 為空', size: 0, suggestion: '主設定檔為空，酒館可能無法正常啟動。' }); crit++; }
        } catch (e) { ci.push({ path: 'config.yaml', category: '系統設定', severity: 'critical', error: '無法讀取', size: 0, suggestion: '無法存取主設定檔。' }); crit++; }
        cats.push({ name: '系統設定', icon: '🔩', total: 1, issues: ci });
    }

    return { scanTime: new Date().toISOString(), summary: { totalFiles, critical: crit, warning: warn, info: inf }, categories: cats };
}

function makeReport(sr) {
    let r = '# 🏥 SillyTavern 資料健康檢查報告 (CLI 版)\n';
    r += `> 掃描時間：${new Date(sr.scanTime).toLocaleString('zh-TW')}\n\n`;
    r += '## 📊 摘要\n';
    r += `- 總掃描檔案：${sr.summary.totalFiles}\n`;
    r += `- 🔴 嚴重問題：${sr.summary.critical}\n`;
    r += `- 🟡 警告：${sr.summary.warning}\n`;
    r += `- 🔵 資訊：${sr.summary.info}\n\n`;

    if (sr.summary.critical === 0 && sr.summary.warning === 0 && sr.summary.info === 0) {
        r += '✅ **所有檔案都很健康！沒有發現任何問題。**\n';
    } else {
        const grouped = { critical: [], warning: [], info: [] };
        sr.categories.forEach(c => c.issues.forEach(i => grouped[i.severity].push({ ...i, catName: c.name, catIcon: c.icon })));

        if (grouped.critical.length) {
            r += '## 🔴 嚴重問題（需要立即處理）\n\n';
            grouped.critical.forEach((i, n) => {
                r += `### ${n + 1}. ${i.catIcon} ${i.catName}\n`;
                r += `- **檔案**：\`${i.path}\`\n`;
                r += `- **錯誤**：${i.error}\n`;
                r += `- **建議**：${i.suggestion}\n\n`;
            });
        }
        if (grouped.warning.length) {
            r += '## 🟡 警告（建議處理）\n\n';
            grouped.warning.forEach((i, n) => {
                r += `${n + 1}. \`${i.path}\` — ${i.error}\n   建議：${i.suggestion}\n\n`;
            });
        }
    }
    r += '---\n💡 **請將上述報告複製，並交由 AI 協助分析。**\n';
    return r;
}

console.log("🔍 開始掃描 SillyTavern 資料...\n");
const result = fullScan();
console.log(makeReport(result));
