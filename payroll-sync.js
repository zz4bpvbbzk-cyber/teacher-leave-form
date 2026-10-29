/*!
 * 新興國小 請假表單 → 薪資系統 同步程式（表單端）
 * ─────────────────────────────────────────────
 * 功能：
 *   1. 在「課務／級務處理」區自動注入「代課教師（鐘點費受領人）」欄位
 *      （位置在級務代理人下方，產生 PDF 時會一併印出）
 *   2. 假單（PDF）下載完成後自動送出：把請假人、假別、代課明細
 *      （含每列的公費/自費標記、金額）送到 Google 試算表
 *   3. 伺服器端會自動去除重複（同一筆明細不會重複寫入）
 *
 * 安裝：
 *   ① 把本檔案上傳到表單 repo 根目錄，檔名 payroll-sync.js
 *   ② 在 index.html 的 </body> 之前加一行：
 *        <script src="payroll-sync.js"></script>
 *   ③ 把下面 CONFIG.URL 的引號內換成 Apps Script 部署後的網址
 */
(function () {
  'use strict';

  /* ================= ① 設定區（唯一要改的地方） ================= */
    var CONFIG = {
    URL: 'https://script.google.com/macros/s/AKfycbyq5UybXN7ixC72EyMDEfO4c5uPkTmC67XdB9iCFvFHcQW51f_30qUa24--3tHXtcnQzw/exec',
  };
 
  /* ================= 以下不用改 ================= */

  if (!document.querySelector('[data-key="teacherName"]')) return;

  /* ---------- ② 注入「代課教師」欄位 ---------- */
  var duty = document.querySelector('.opt.duty-agent');
  if (duty && !document.getElementById('subTeacher')) {
    var wrap = document.createElement('div');
    wrap.className = 'opt';
        wrap.className = 'opt';
    wrap.innerHTML =
      '<label class="ck" style="display:flex;align-items:center;gap:4px">' +
      '<input id="subTeacher" type="text" placeholder="選填，可留空" ' +
      'style="all:unset;display:inline-block;width:10em;height:1.6em;position:static;opacity:1;' +
      'pointer-events:auto;background:#fff;border:1px dashed #888;border-radius:3px;' +
      'padding:2px 6px;font:inherit;color:#000;box-sizing:content-box">' +
      '</label>';

    duty.parentNode.insertBefore(wrap, duty.nextSibling);

    // 代課教師姓名自動記憶（跟表單原本的自動儲存行為一致）
    var st = document.getElementById('subTeacher');
    try {
      var saved = localStorage.getItem('payroll-sub-teacher');
      if (saved && !st.value) st.value = saved;
      st.addEventListener('input', function () {
        try { localStorage.setItem('payroll-sub-teacher', this.value); } catch (e) {}
      });
    } catch (e) {}
  }

  /* ---------- ③ 自動送出：假單（PDF）下載完成後觸發，不另設按鈕 ---------- */
  window.addEventListener('leaveform-pdf-saved', function(){ try{ submit(); }catch(e){} });

  /* ---------- ④ 讀取表單資料 ---------- */
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

  // 勾選的假別（直接取表單上 label 的文字）
  function leaveTypes() {
    var out = [];
    for (var i = 1; i <= 12; i++) {
      if (chk('type' + i)) out.push(labelText('type' + i));
    }
    var other = val('typeOther');
    if (other) out.push('其他（' + other + '）');
    return out;
  }

  // 表單層的公費/自費預設：假別含「派代」→公費、含「自理」→自費
  function defaultFee() {
    var types = leaveTypes().join(' ');
    if (/自理/.test(types)) return '自費';
    if (/派代/.test(types)) return '公費';
    return '';
  }

  // 逐列讀取課務明細（採用表單原有的兩個勾選欄：fee1=由總務處轉(公費)、fee2=自理(自費)）
  function collectRows() {
    var rows = [];
    var incList = document.querySelectorAll('[data-key$="_inc"]');
    for (var i = 0; i < incList.length; i++) {
      var inc = incList[i];
      if (!inc.checked) continue;
      var g = inc.getAttribute('data-key').slice(1, -4); // c12_inc → 12
      var period = val('c' + g + '_period');
      var cls = val('c' + g + '_class');
      var subj = val('c' + g + '_subj');
      var amt = val('c' + g + '_amt');
      if (!period && !cls && !subj && !amt) continue; // 整列空白就不送
      var fee;
      if (chk('c' + g + '_fee1') && chk('c' + g + '_fee2')) fee = '待確認';
      else if (chk('c' + g + '_fee1')) fee = '公費';
      else if (chk('c' + g + '_fee2')) fee = '自費';
      else fee = defaultFee();
      rows.push({
        m: val('c' + g + '_m'),
        d: val('c' + g + '_d'),
        w: val('c' + g + '_w'),
        period: period,
        cls: cls,
        subj: subj,
        fee: fee,
        fee1: chk('c' + g + '_fee1'),
        fee2: chk('c' + g + '_fee2'),
        amt: amt
      });
    }
    return rows;
  }

  function periodText() {
    if (!val('sY')) return '';
    var f = function (p) {
      return p[0] + '年' + p[1] + '月' + p[2] + '日 ' + p[3] + ':' + p[4];
    };
    var a = [val('sY'), val('sM'), val('sD'), val('sH'), val('sMin')];
    var b = [val('eY'), val('eM'), val('eD'), val('eH'), val('eMin')];
    return f(a) + ' ～ ' + f(b);
  }

  function payload() {
    var now = new Date();
    var pad = function (n) { return ('0' + n).slice(-2); };
    var totalEl = document.getElementById('totalDisplay');
    var subEl = document.getElementById('subTeacher');
    return {
      submittedAt: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
                   ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
      teacherName: val('teacherName'),
      leaveTypes: leaveTypes(),
      reason: val('reason'),
      period: periodText(),
      totalText: totalEl ? totalEl.textContent.trim() : '',
      subTeacher: subEl ? String(subEl.value || '').trim() : '',
      dutyAgent: val('dutyAgent'),
      options: [1, 2, 3, 4].map(function (i) {
        return chk('opt' + i) ? labelText('opt' + i) : '';
      }).filter(Boolean),
      rows: collectRows(),
      page: location.href
    };
  }

  /* ---------- ⑤ 送出 ---------- */
  function submit() {
    if (!CONFIG.URL || CONFIG.URL.indexOf('https://script.google') !== 0) {
      return; // 未設定網址 → 靜默略過
    }
    var p = payload();
    if (!p.teacherName) { alert('請先填寫「請假教師」姓名。'); return; }
    if (!p.rows.length) { return; } // 無勾「印」明細 → 靜默略過

    fetch(CONFIG.URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(p)
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          console.log('薪資系統同步完成：新增 ' + res.added + ' 筆' + (res.duplicate ? ('，重複略過 ' + res.duplicate + ' 筆') : ''));
        } else {
          throw new Error((res && res.error) || '未知錯誤');
        }
      })
      .catch(function (err) {
        // 備援：改用 no-cors 送出（伺服器照樣收到，且同一筆不會重複寫入）
        try {
          fetch(CONFIG.URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(p) });
        } catch (e) {}
        alert('自動送出狀態未知（' + err.message + '），已改用備援方式送出。\n' +
              '請開啟薪資試算表確認資料是否寫入；同一筆資料不會重複寫入，可放心重送。');
      });
  }
})();
