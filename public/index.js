(function () {
    const MODAL_ID = 'data-doctor-ui';
    const API = '/api/plugins/sillytavern-data-doctor';

    function fmtBytes(b) {
        if (b === 0) return '0 B';
        const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(b) / Math.log(k));
        return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
    }

    function badge(sev) {
        const m = { critical: ['🔴 嚴重', 'dd-critical'], warning: ['🟡 警告', 'dd-warning'], info: ['🔵 資訊', 'dd-info'] };
        const [t, c] = m[sev] || [sev, ''];
        return '<span class="dd-badge ' + c + '">' + t + '</span>';
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    window.dataDoctor = {
        _data: null,

        show() {
            if (document.getElementById(MODAL_ID)) document.getElementById(MODAL_ID).remove();
            const html = '<div id="' + MODAL_ID + '" class="dd-mask">' +
              '<div class="dd-win">' +
                '<div class="dd-head">' +
                  '<h3><i class="fa-solid fa-stethoscope"></i> 資料健檢 DataDoctor <small>v1.0</small></h3>' +
                  '<div class="dd-close" onclick="document.getElementById(\'' + MODAL_ID + '\').remove()">×</div>' +
                '</div>' +
                '<div class="dd-toolbar">' +
                  '<button id="dd-btn-scan" class="dd-btn primary" onclick="dataDoctor.scan()">' +
                    '<i class="fa-solid fa-magnifying-glass-chart"></i> 全面掃描</button>' +
                  '<button id="dd-btn-copy" class="dd-btn secondary" onclick="dataDoctor.copyReport()" disabled>' +
                    '<i class="fa-solid fa-clipboard"></i> 複製 AI 報告</button>' +
                  '<button id="dd-btn-logs" class="dd-btn secondary" onclick="dataDoctor.showLogs()">' +
                    '<i class="fa-solid fa-terminal"></i> 酒館錯誤日誌</button>' +
                '</div>' +
                '<div id="dd-summary" class="dd-summary" style="display:none;"></div>' +
                '<div id="dd-results" class="dd-results">' +
                  '<div class="dd-placeholder"><i class="fa-solid fa-heart-pulse"></i><br>點擊「全面掃描」開始檢查所有資料檔案</div>' +
                '</div>' +
                '<div class="dd-foot">Plugin by Minijinai75 · SillyTavern-DataDoctor</div>' +
              '</div>' +
            '</div>';
            document.body.insertAdjacentHTML('beforeend', html);
        },

        async scan() {
            const btn = document.getElementById('dd-btn-scan');
            const resDiv = document.getElementById('dd-results');
            const sumDiv = document.getElementById('dd-summary');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 掃描中...';
            resDiv.innerHTML = '<div class="dd-placeholder"><i class="fa-solid fa-spinner fa-spin" style="font-size:2em;"></i><br>正在掃描所有資料檔案，請稍候...</div>';
            sumDiv.style.display = 'none';
            try {
                const resp = await fetch(API + '/scan');
                const data = await resp.json();
                this._data = data;
                this.renderSummary(data);
                this.renderResults(data);
                document.getElementById('dd-btn-copy').disabled = false;
            } catch (e) {
                resDiv.innerHTML = '<div class="dd-error">掃描失敗：' + esc(e.message) + '</div>';
            }
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-magnifying-glass-chart"></i> 重新掃描';
        },

        renderSummary(data) {
            const s = data.summary;
            const div = document.getElementById('dd-summary');
            const ok = s.critical === 0 && s.warning === 0;
            div.className = 'dd-summary ' + (ok ? 'dd-sum-ok' : 'dd-sum-bad');
            div.style.display = 'flex';
            div.innerHTML =
              '<div class="dd-sum-icon">' + (ok ? '✅' : '⚠️') + '</div>' +
              '<div class="dd-sum-stats">' +
                '<div class="dd-sum-title">已掃描 ' + s.totalFiles + ' 個檔案</div>' +
                '<div class="dd-sum-detail">' +
                  '<span class="dd-stat-crit">' + s.critical + ' 嚴重</span>' +
                  '<span class="dd-stat-warn">' + s.warning + ' 警告</span>' +
                  '<span class="dd-stat-info">' + s.info + ' 資訊</span>' +
                '</div>' +
              '</div>';
        },

        renderResults(data) {
            const div = document.getElementById('dd-results');
            let html = '';
            data.categories.forEach(function (cat, ci) {
                const hasIssues = cat.issues.length > 0;
                html += '<div class="dd-cat">';
                html += '<div class="dd-cat-head" onclick="dataDoctor.toggleCat(' + ci + ')">';
                html += '<span class="dd-cat-icon">' + cat.icon + '</span>';
                html += '<span class="dd-cat-name">' + esc(cat.name) + '</span>';
                html += '<span class="dd-cat-count">' + cat.total + ' 個檔案</span>';
                if (hasIssues) html += '<span class="dd-cat-issues">' + cat.issues.length + ' 問題</span>';
                else html += '<span class="dd-cat-ok">✓</span>';
                html += '<i class="fa-solid fa-chevron-down dd-cat-arrow"></i>';
                html += '</div>';
                html += '<div class="dd-cat-body" id="dd-cat-' + ci + '" style="display:none;">';
                if (!hasIssues) {
                    html += '<div class="dd-cat-empty">全部正常 👍</div>';
                } else {
                    cat.issues.forEach(function (issue, fi) {
                        var shortPath = issue.path.replace(/^default-user[\\/]/, '');
                        var uid = 'dd-f-' + ci + '-' + fi;
                        var escapedPath = issue.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                        html += '<div class="dd-file" id="' + uid + '">';
                        html += '<div class="dd-file-info">';
                        html += '<div class="dd-file-top">' + badge(issue.severity) + ' <span class="dd-file-path">' + esc(shortPath) + '</span></div>';
                        html += '<div class="dd-file-error">' + esc(issue.error) + '</div>';
                        if (issue.suggestion) html += '<div class="dd-file-sug">💡 ' + esc(issue.suggestion) + '</div>';
                        if (issue.size > 0) html += '<div class="dd-file-size">' + fmtBytes(issue.size) + '</div>';
                        html += '</div>';
                        html += '<button class="dd-btn-del" onclick="dataDoctor.deleteFile(\'' + escapedPath + '\',\'' + uid + '\')" title="刪除"><i class="fa-solid fa-trash"></i></button>';
                        html += '</div>';
                    });
                }
                html += '</div></div>';
            });
            div.innerHTML = html;
        },

        toggleCat(ci) {
            var body = document.getElementById('dd-cat-' + ci);
            body.style.display = body.style.display === 'none' ? 'block' : 'none';
        },

        async deleteFile(fp, uid) {
            if (!confirm('確定要刪除此損壞檔案？\n\n' + fp + '\n\n刪除後無法復原！')) return;
            try {
                var resp = await fetch(API + '/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filePath: fp }) });
                var d = await resp.json();
                if (d.success) {
                    var el = document.getElementById(uid);
                    if (el) { el.style.opacity = '0.3'; el.innerHTML = '<div style="padding:8px;color:#4caf50;"><i class="fa-solid fa-check"></i> 已刪除</div>'; }
                } else { alert('刪除失敗：' + d.error); }
            } catch (e) { alert('刪除失敗：' + e.message); }
        },

        async copyReport() {
            try {
                var resp = await fetch(API + '/report');
                var d = await resp.json();
                await navigator.clipboard.writeText(d.report);
                alert('✅ 報告已複製到剪貼簿！\n可以直接貼給 AI 協助分析。');
            } catch (e) { alert('複製失敗：' + e.message); }
        },

        async showLogs() {
            try {
                var resp = await fetch(API + '/logs');
                var d = await resp.json();
                var div = document.getElementById('dd-results');
                if (!d.logs.length) { div.innerHTML = '<div class="dd-placeholder">沒有捕捉到酒館錯誤日誌。</div>'; return; }
                var html = '<div class="dd-logs-title"><i class="fa-solid fa-terminal"></i> 酒館主程式錯誤日誌（最近 100 筆）</div>';
                html += '<div class="dd-logs-wrap"><pre class="dd-logs-pre">';
                d.logs.forEach(function (l) {
                    var cls = l.level === 'error' ? 'dd-log-err' : 'dd-log-warn';
                    html += '<span class="' + cls + '">[' + l.level.toUpperCase() + ' ' + l.time + ']</span> ' + esc(l.message.substring(0, 300)) + '\n';
                });
                html += '</pre></div>';
                div.innerHTML = html;
            } catch (e) { alert('取得日誌失敗：' + e.message); }
        },
    };

    // 注入按鈕到 ST 擴充選單
    var poll = setInterval(function () {
        var bar = document.getElementById('extensionsMenu');
        if (bar && !document.getElementById('dd-open-btn')) {
            var btn = document.createElement('div');
            btn.id = 'dd-open-btn';
            btn.className = 'list-group-item flex-container flex-gap-10 interactable';
            btn.innerHTML = '<div class="fa-solid fa-stethoscope"></div><div>資料健檢</div>';
            btn.onclick = function () { dataDoctor.show(); };
            bar.appendChild(btn);
            clearInterval(poll);
        }
    }, 2000);
})();
