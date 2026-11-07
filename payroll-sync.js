/*!
 * 新興國小 請假表單 → 薪資系統 同步程式（表單端）v2（表單 v84 起）
 * ─────────────────────────────────────────
 * 下載假單時，先向後端 Apps Script 取得「全校統一 3 位數流水號」並登錄
 * 派代明細；回傳的流水號由表單蓋在假單右上角（同一次下載的多頁共用同一號）。
 * 相同內容重複下載不會重複發號、不會重複寫入；修改內容後再下載會取得新號。
 *
 * 後端：請將 apps-script-Code.gs 的內容貼入 Apps Script 專案並重新部署
 *       （部署 → 管理部署作業 → 編輯 → 版本：新版本 → 部署，網址不變）。
 */
(function () {
  'use strict';

  var CONFIG = {
    URL: 'https://script.google.com/macros/s/AKfycbyq5UybXN7ixC72EyMDEfO4c5uPkTmC67XdB9iCFvFHcQW51f_30qUa24--3tHXtcnQzw/exec',
    TIMEOUT: 12000
  };

  if (!document.querySelector('[data-key="teacherName"]')) return;

  /* ---------- 讀取表單資料 ---------- */
  function val(key) {
    var el = document.querySelector('[data-key="' + key + '"]');
    return el ? String(el.value || '').trim() : '';
  }
  function chk(key) {
    var el = document.querySelector('[data-key="' + key + '"]');
    return !!(el && el.checked);
  }
  function labelText(key) {
    var el = document.querySelector('[data-key="' + key + '"]');
    if (!el) return '';
    var lab = el.closest ? el.closest('label') : null;
    return lab ? lab.textContent.replace(/\s+/g, ' ').trim() : '';
  }
  function leaveTypes() {
    var out = [];
    for (var i = 1; i <= 12; i++) { if (chk('type' + i)) out.push(labelText('type' + i)); }
    var other = val('typeOther');
    if (other) out.push('其他（' + other + '）');
    return out;
  }
  function defaultFee() {
    var types = leaveTypes().join(' ');
    if (/自理/.test(types)) return '自費';
    if (/派代/.test(types)) return '公費';
    return '';
  }
  function collectRows() {
    var rows = [];
    var incList = document.querySelectorAll('[data-key$="_inc"]');
    for (var i = 0; i < incList.length; i++) {
      var inc = incList[i];
      if (!inc.checked) continue;
      var g = inc.getAttribute('data-key').slice(1, -4);
      var period = val('c' + g + '_period');
      var cls = val('c' + g + '_class');
      var subj = val('c' + g + '_subj');
      var amt = val('c' + g + '_amt');
      if (!period && !cls && !subj && !amt) continue;
      var fee;
      if (chk('c' + g + '_fee1') && chk('c' + g + '_fee2')) fee = '待確認';
      else if (chk('c' + g + '_fee1')) fee = '公費';
      else if (chk('c' + g + '_fee2')) fee = '自費';
      else fee = defaultFee();
      rows.push({
        m: val('c' + g + '_m'), d: val('c' + g + '_d'), w: val('c' + g + '_w'),
        period: period, cls: cls, subj: subj, fee: fee, amt: amt
      });
    }
    return rows;
  }
  function periodText() {
    if (!val('sY')) return '';
    var f = function (p) { return p[0] + '年' + p[1] + '月' + p[2] + '日 ' + p[3] + ':' + p[4]; };
    var a = [val('sY'), val('sM'), val('sD'), val('sH'), val('sMin')];
    var b = [val('eY'), val('eM'), val('eD'), val('eH'), val('eMin')];
    return f(a) + ' ～ ' + f(b);
  }
  function payload() {
    var now = new Date();
    var pad = function (n) { return ('0' + n).slice(-2); };
    var totalEl = document.getElementById('totalDisplay');
    return {
      submittedAt: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
                   ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
      teacherName: val('teacherName'),
      leaveTypes: leaveTypes(),
      reason: val('reason'),
      period: periodText(),
      totalText: totalEl ? totalEl.textContent.trim() : '',
      subTeacher: val('subTeacher'),
      dutyAgent: val('dutyAgent'),
      options: [1, 2, 3, 4].map(function (i) {
        return chk('opt' + i) ? labelText('opt' + i) : '';
      }).filter(Boolean),
      rows: collectRows(),
      page: location.href
    };
  }
  function fpHash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return 'h' + (h >>> 0).toString(36);
  }

  /* ---------- 取號：下載假單前呼叫，回傳 Promise ----------
   * 成功：{ ok:true, serial:'NNN' }（後端已登錄明細並發全校流水號）
   * 無明細：{ ok:true, serial:null }（沒有勾「印」的列，不需編號）
   * 失敗：{ ok:false, reason:'timeout'|'network'|... }
   */
  window.payrollIssueSerial = function () {
    return new Promise(function (resolve) {
      var p = payload();
      if (!p.rows.length) { resolve({ ok: true, serial: null, skip: true }); return; }
      var fp = fpHash(JSON.stringify({
        t: p.teacherName, s: p.period,
        r: p.rows.map(function (r) { return r.m + r.d + r.w + r.period + r.cls + r.subj + r.amt + r.fee; })
      }));
      try {
        var saved = JSON.parse(localStorage.getItem('payroll-last-issue') || 'null');
        if (saved && saved.fp === fp && saved.serial) { resolve({ ok: true, serial: saved.serial, reused: true }); return; }
      } catch (e) {}
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve({ ok: false, reason: 'timeout' }); } }, CONFIG.TIMEOUT);
      fetch(CONFIG.URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(p)
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (done) return;
          done = true; clearTimeout(timer);
          if (res && res.ok && res.serial) {
            try { localStorage.setItem('payroll-last-issue', JSON.stringify({ fp: fp, serial: res.serial })); } catch (e) {}
            resolve({ ok: true, serial: res.serial, added: res.added });
          } else {
            resolve({ ok: false, reason: (res && res.error) || 'server' });
          }
        })
        .catch(function () {
          if (done) return;
          done = true; clearTimeout(timer);
          resolve({ ok: false, reason: 'network' });
        });
    });
  };
})();
