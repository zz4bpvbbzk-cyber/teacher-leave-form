/************************************************
 * 新興國小 假單 → 薪資系統 後端（Apps Script）v2
 * ─────────────────────────────────────────────
 * 功能：
 *   1. 全校統一發號：每次送入發一個 3 位數連續流水號（001~999，全校一個計數器）
 *      （LockService 鎖定，兩位老師同時下載也不會重號）
 *   2. 明細登錄：派代明細（勾「印」的每節一列）按「請假日期」所屬月份
 *      寫入對應月份頁籤（2026-11、2026-12…，跨月請假會分寫兩個月籤），
 *      首欄即「流水號」——老師修改假單重送會得到新號，教學組認最新號計費
 *   3. 去重：同一份內容重複送出（重複下載）回傳同一號、不重複寫入
 *
 * 安裝（一次性）：
 *   ① 開啟你的 Apps Script 專案，整份取代現有程式碼後存檔
 *   ② 若指令碼「不是」附加在試算表下：把 SPREADSHEET_ID 填上試算表 ID
 *   ③ 部署 → 管理部署作業 → 筆鉛筆(編輯) → 版本：新版本 → 部署（網址不變）
 ************************************************/

var SHEET_NAME = '';       // 留空 = 用試算表第一張工作表；或填工作表名稱，如 '派代明細'
var SPREADSHEET_ID = '';   // 指令碼未附加於試算表時必填（試算表網址中 /d/ 與 /edit 之間那串）

var HEADERS = ['流水號','送出時間','請假教師','假別','請假期間','日(時)數','日期','星期','節次','班級','科目','費用別','金額','代課教師','級務代理人','處理方式','請假事由'];

function doPost(e) {
  var out;
  try {
    var p = JSON.parse(e.postData.contents);
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var props = PropertiesService.getScriptProperties();
      var fp = fpHash(JSON.stringify({
        t: p.teacherName, s: p.period,
        r: (p.rows || []).map(function (r) { return [r.m, r.d, r.period, r.cls, r.subj, r.amt, r.fee].join('|'); })
      }));
      if (props.getProperty('lastFp') === fp && props.getProperty('lastSerial')) {
        out = { ok: true, serial: props.getProperty('lastSerial'), duplicate: true };
      } else {
        var n = parseInt(props.getProperty('serialCounter') || '0', 10) + 1;
        var serial = ('000' + n).slice(-3);
        var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
        // 請假起始年月（解析「請假期間」開頭的 2026年11月…），用於跨年判斷
        var startY = 0, startM = 0, mm2 = /(\d{4})年(\d{1,2})月/.exec(String(p.period || ''));
        if (mm2) { startY = parseInt(mm2[1], 10); startM = parseInt(mm2[2], 10); }
        (p.rows || []).forEach(function (r) {
          // 每節課依「請假日期」的月份歸入月份頁籤；跨年（如 12月底→1月）自動遞增年份
          var mo = parseInt(r.m, 10), yr = startY;
          if (!mo || mo < 1 || mo > 12) mo = startM || 1;
          if (startY) { if (mo < startM) yr = startY + 1; } else { yr = new Date().getFullYear(); }
          var tab = yr + '-' + ('0' + mo).slice(-2);
          var sh = ss.getSheetByName(tab) || ss.insertSheet(tab);
          if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
          var rowVals = [ '', p.submittedAt, p.teacherName, (p.leaveTypes || []).join('、'),
                        p.period, p.totalText, r.m + '/' + r.d, r.w, r.period, r.cls, r.subj, r.fee, r.amt,
                        p.subTeacher, p.dutyAgent, (p.options || []).join('、'), p.reason];
          sh.appendRow(rowVals);
          // 流水號用 setValue 以「文字」寫入（setValue 不會像輸入那樣把 001 轉成數字 1），並固定文字格式
          sh.getRange(sh.getLastRow(), 1).setNumberFormat('@').setValue(serial); // 先設文字格式再寫值：setValue 在自動格式下會把 '001' 轉成數字 1
        });
        props.setProperty('serialCounter', String(n));
        props.setProperty('lastFp', fp);
        props.setProperty('lastSerial', serial);
        out = { ok: true, serial: serial, added: (p.rows || []).length };
      }
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

var VERSION = '3.3';

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'payroll-serial', ver: VERSION }))
    .setMimeType(ContentService.MimeType.JSON);
}

function fpHash(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return 'h' + (h >>> 0).toString(36);
}
