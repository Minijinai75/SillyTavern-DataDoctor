const path = require('path');
const fs = require('fs');

const PLUGIN_ID = 'sillytavern-data-doctor';
const PLUGIN_DIR = __dirname;
const EXTENSION_NAME = 'SillyTavern-DataDoctor';

let lastScanResult = null;
const capturedLogs = [];
const MAX_LOG_ENTRIES = 500;

// ==================== 酒館錯誤日誌捕捉 ====================

function setupLogCapture() {
    const origError = console.error;
    const origWarn = console.warn;

    console.error = function (...args) {
        const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        capturedLogs.push({ level: 'error', message: msg, time: new Date().toISOString() });
        if (capturedLogs.length > MAX_LOG_ENTRIES) capturedLogs.shift();
        origError.apply(console, args);
    };

    console.warn = function (...args) {
        const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        capturedLogs.push({ level: 'warn', message: msg, time: new Date().toISOString() });
        if (capturedLogs.length > MAX_LOG_ENTRIES) capturedLogs.shift();
        origWarn.apply(console, args);
    };
}

// ==================== 工具函式 ====================

function installFrontend() {
    const extDir = path.join(
        process.cwd(), 'public', 'scripts', 'extensions', 'third-party', EXTENSION_NAME,
    );
    try {
        if (!fs.existsSync(extDir)) fs.mkdirSync(extDir, { recursive: true });
        ['index.js', 'style.css', 'manifest.json'].forEach(f => {
            const src = path.join(PLUGIN_DIR, 'public', f);
            const dest = path.join(extDir, f);
            if (fs.existsSync(src)) fs.copyFileSync(src, dest);
        });
        console.log('[DataDoctor] 前端擴充已安裝/更新。');
    } catch (err) {
        console.log('[DataDoctor] 前端安裝錯誤:', err.message);
    }
}

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

// ==================== 檢查函式 ====================

function baseChecks(fp, rp, cat) {
    const issues = [];
    try {
        const stat = fs.statSync(fp);
        if (stat.size === 0) {
            issues.push({ path: rp, category: cat, severity: 'critical', error: '檔案為空 (0 bytes)', size: 0, suggestion: '此檔案完全為空，無法被酒館讀取。建議刪除。' });
            return issues;
        }
        if (stat.size > 50 * 1024 * 1024) {
            issues.push({ path: rp, category: cat, severity: 'warning', error: '檔案異常大 (' + fmtBytes(stat.size) + ')', size: stat.size, suggestion: '超過 50MB，可能導致載入緩慢或記憶體問題。' });
        }
        const fd = fs.openSync(fp, 'r');
        const buf = Buffer.alloc(Math.min(stat.size, 8192));
        fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        const bom = hasBOM(buf);
        if (bom) {
            issues.push({ path: rp, category: cat, severity: 'warning', error: '偵測到 ' + bom, size: stat.size, suggestion: 'BOM 標記可能導致 JSON 解析失敗。建議移除 BOM。' });
        }
        if (hasNullBytes(buf)) {
            issues.push({ path: rp, category: cat, severity: 'warning', error: '偵測到 NULL 字元（可能為編碼損壞）', size: stat.size, suggestion: '檔案包含空字元，可能表示編碼錯誤或檔案損壞。' });
        }
        const fn = path.basename(fp);
        if (/[<>:"|?*]/.test(fn)) {
            issues.push({ path: rp, category: cat, severity: 'info', error: '檔名含特殊字元: ' + fn, size: stat.size, suggestion: '某些系統可能無法正確處理此檔名。' });
        }
    } catch (err) {
        issues.push({ path: rp, category: cat, severity: 'critical', error: '無法讀取: ' + err.message, size: 0, suggestion: '檔案可能已損壞或權限不足。' });
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
                    issues.push({ path: rp, category: cat, severity: 'warning', error: '缺少必要欄位: ' + f, size: stat.size, suggestion: '缺少 "' + f + '" 欄位，可能導致功能異常。' });
                }
            }
        } catch (pe) {
            issues.push({ path: rp, category: cat, severity: 'critical', error: 'JSON 解析失敗: ' + pe.message.substring(0, 100), size: stat.size, suggestion: '此檔案 JSON 格式有語法錯誤，酒館無法正確載入。' });
        }
    } catch (_) { /* already caught */ }
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
                    issues.push({ path: rp, category: cat, severity: 'critical', error: '第 ' + (i + 1) + ' 行 JSON 解析失敗: ' + pe.message.substring(0, 80), size: stat.size, suggestion: '此聊天紀錄在第 ' + (i + 1) + ' 行損壞。會導致酒館變卡甚至影響 API 表現。建議刪除或手動修復。' });
                    errFound = true;
                }
            }
        }
        const nonEmpty = lines.filter(l => l.trim()).length;
        if (emptyCount > nonEmpty && nonEmpty > 0) {
            issues.push({ path: rp, category: cat, severity: 'info', error: '含大量空行 (' + emptyCount + '/' + lines.length + ')', size: stat.size, suggestion: '大量空行浪費空間但通常不影響功能。' });
        }
    } catch (_) { /* already caught */ }
    return issues;
}

// ==================== 目錄掃描 ====================

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

// ==================== 完整掃描 ====================

function fullScan(typeFilter) {
    const dr = getDataRoot();
    const cats = [];
    let totalFiles = 0, crit = 0, warn = 0, inf = 0;

    const configs = [
        { type: 'chats', name: '個人聊天紀錄', icon: '💬', dir: path.join(dr, 'chats'), ext: '.jsonl', fn: scanJsonl, req: [] },
        { type: 'group_chats', name: '群組聊天紀錄', icon: '👥', dir: path.join(dr, 'group chats'), ext: '.jsonl', fn: scanJsonl, req: [] },
        { type: 'characters', name: '角色卡', icon: '🎭', dir: path.join(dr, 'characters'), ext: '.json', fn: scanJson, req: ['name'] },
        { type: 'worlds', name: '世界書 Lorebook', icon: '🌍', dir: path.join(dr, 'worlds'), ext: '.json', fn: scanJson, req: ['entries'] },
        { type: 'groups', name: '群組設定', icon: '📁', dir: path.join(dr, 'groups'), ext: '.json', fn: scanJson, req: ['members'] },
        { type: 'textgen', name: 'TextGen 預設檔', icon: '⚙️', dir: path.join(dr, 'TextGen Settings'), ext: '.json', fn: scanJson, req: [] },
        { type: 'openai', name: 'OpenAI 預設檔', icon: '⚙️', dir: path.join(dr, 'OpenAI Settings'), ext: '.json', fn: scanJson, req: [] },
        { type: 'novelai', name: 'NovelAI 預設檔', icon: '⚙️', dir: path.join(dr, 'NovelAI Settings'), ext: '.json', fn: scanJson, req: [] },
        { type: 'koboldai', name: 'KoboldAI 預設檔', icon: '⚙️', dir: path.join(dr, 'KoboldAI Settings'), ext: '.json', fn: scanJson, req: [] },
        { type: 'context', name: '上下文模板', icon: '📝', dir: path.join(dr, 'context'), ext: '.json', fn: scanJson, req: [] },
        { type: 'instruct', name: '指令模板', icon: '📋', dir: path.join(dr, 'instruct'), ext: '.json', fn: scanJson, req: [] },
        { type: 'themes', name: '主題', icon: '🎨', dir: path.join(dr, 'themes'), ext: '.json', fn: scanJson, req: [] },
        { type: 'quickreplies', name: '快速回覆', icon: '⚡', dir: path.join(dr, 'QuickReplies'), ext: '.json', fn: scanJson, req: [] },
        { type: 'vectors', name: '向量資料', icon: '🔢', dir: path.join(dr, 'vectors'), ext: '.json', fn: scanJson, req: [] },
    ];

    if (!typeFilter || typeFilter === 'settings') {
        const sp = path.join(dr, 'settings.json');
        if (fs.existsSync(sp)) {
            totalFiles++;
            const si = scanJson(sp, relPath(sp), '使用者設定');
            si.forEach(i => { if (i.severity === 'critical') crit++; else if (i.severity === 'warning') warn++; else inf++; });
            cats.push({ name: '使用者設定', type: 'settings', icon: '🔧', total: 1, issues: si });
        }
    }

    for (const c of configs) {
        if (typeFilter && typeFilter !== c.type) continue;
        const r = walkDir(c.dir, c.ext, c.name, c.fn, c.req);
        totalFiles += r.total;
        r.issues.forEach(i => { if (i.severity === 'critical') crit++; else if (i.severity === 'warning') warn++; else inf++; });
        cats.push({ name: c.name, type: c.type, icon: c.icon, total: r.total, issues: r.issues });
    }

    if (!typeFilter || typeFilter === 'config') {
        const cp = path.join(process.cwd(), 'config.yaml');
        if (fs.existsSync(cp)) {
            totalFiles++;
            const ci = [];
            try {
                const st = fs.statSync(cp);
                if (st.size === 0) { ci.push({ path: 'config.yaml', category: '系統設定', severity: 'critical', error: 'config.yaml 為空', size: 0, suggestion: '主設定檔為空，酒館可能無法正常啟動。' }); crit++; }
            } catch (e) { ci.push({ path: 'config.yaml', category: '系統設定', severity: 'critical', error: '無法讀取: ' + e.message, size: 0, suggestion: '無法存取主設定檔。' }); crit++; }
            cats.push({ name: '系統設定 (config.yaml)', type: 'config', icon: '🔩', total: 1, issues: ci });
        }
    }

    const result = { scanTime: new Date().toISOString(), summary: { totalFiles, critical: crit, warning: warn, info: inf }, categories: cats };
    lastScanResult = result;
    return result;
}

// ==================== 報告生成 ====================

function makeReport(sr) {
    if (!sr) return '尚未執行掃描。';
    let r = '# 🏥 SillyTavern 資料健康檢查報告\n';
    r += '> 掃描時間：' + new Date(sr.scanTime).toLocaleString('zh-TW') + '\n\n';
    r += '## 📊 摘要\n';
    r += '- 總掃描檔案：' + sr.summary.totalFiles + '\n';
    r += '- 🔴 嚴重問題：' + sr.summary.critical + '\n';
    r += '- 🟡 警告：' + sr.summary.warning + '\n';
    r += '- 🔵 資訊：' + sr.summary.info + '\n\n';

    if (sr.summary.critical === 0 && sr.summary.warning === 0 && sr.summary.info === 0) {
        r += '✅ **所有檔案都很健康！沒有發現任何問題。**\n';
    } else {
        const grouped = { critical: [], warning: [], info: [] };
        sr.categories.forEach(c => c.issues.forEach(i => grouped[i.severity].push({ ...i, catName: c.name, catIcon: c.icon })));

        if (grouped.critical.length) {
            r += '## 🔴 嚴重問題（需要立即處理）\n\n';
            grouped.critical.forEach((i, n) => {
                r += '### ' + (n + 1) + '. ' + i.catIcon + ' ' + i.catName + '\n';
                r += '- **檔案**：`' + i.path + '`\n';
                r += '- **錯誤**：' + i.error + '\n';
                if (i.size > 0) r += '- **大小**：' + fmtBytes(i.size) + '\n';
                r += '- **建議**：' + i.suggestion + '\n\n';
            });
        }
        if (grouped.warning.length) {
            r += '## 🟡 警告（建議處理）\n\n';
            grouped.warning.forEach((i, n) => {
                r += (n + 1) + '. `' + i.path + '` — ' + i.error + '\n   建議：' + i.suggestion + '\n\n';
            });
        }
        if (grouped.info.length) {
            r += '## 🔵 資訊（供參考）\n\n';
            grouped.info.forEach((i, n) => { r += (n + 1) + '. `' + i.path + '` — ' + i.error + '\n'; });
            r += '\n';
        }
    }

    // 附加酒館本身的錯誤日誌
    const stErrors = capturedLogs.filter(l =>
        l.message.includes('invalid') || l.message.includes('corrupt') ||
        l.message.includes('error') || l.message.includes('Error') ||
        l.message.includes('failed') || l.message.includes('ENOENT')
    );
    if (stErrors.length > 0) {
        r += '## 📜 酒館主程式錯誤日誌（自動捕捉）\n\n';
        r += '以下是酒館啟動後 console 輸出的錯誤/警告，可能與上述問題相關：\n\n';
        r += '```\n';
        stErrors.slice(-30).forEach(l => { r += '[' + l.level.toUpperCase() + ' ' + l.time + '] ' + l.message.substring(0, 200) + '\n'; });
        r += '```\n\n';
    }

    r += '---\n請協助我分析以上問題，並提供具體的解決方案。\n';
    return r;
}

// ==================== 初始化 ====================

function init(app) {
    setupLogCapture();
    installFrontend();

    app.get('/scan', (req, res) => {
        try { res.json(fullScan(req.query.type || null)); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/report', (_req, res) => {
        res.json({ report: makeReport(lastScanResult) });
    });

    app.get('/logs', (_req, res) => {
        res.json({ logs: capturedLogs.slice(-100) });
    });

    app.post('/delete', (req, res) => {
        const { filePath: rp } = req.body;
        if (!rp) return res.status(400).json({ error: '未指定檔案路徑' });
        const fp = path.join(process.cwd(), 'data', rp);
        const dataDir = path.resolve(path.join(process.cwd(), 'data'));
        if (!path.resolve(fp).startsWith(dataDir)) return res.status(403).json({ error: '路徑不合法' });
        if (!fs.existsSync(fp)) return res.status(404).json({ error: '檔案不存在' });
        try { fs.unlinkSync(fp); res.json({ success: true }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    console.log('[DataDoctor] 🏥 插件已載入！');
}

module.exports = {
    init,
    info: { id: PLUGIN_ID, name: '資料健檢 DataDoctor', description: 'SillyTavern 全方位資料健康診斷工具' },
};
