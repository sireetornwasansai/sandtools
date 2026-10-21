// SAND Office Tools — ระบบบันทึกการปฏิบัติงาน (HR) — page logic.
// GENERATED from the stand-alone "ระบบบันทึกการปฏิบัติงาน" web app (Index.html) by tools/gen-hr.py, then kept as ordinary source.
// What changed compared with the original page (behaviour is the same):
//   • runs inside a Shadow DOM root ($r) so its styles never collide with SAND's;  document.getElementById → $r.getElementById
//   • no inline on*= attributes (SAND's CSP forbids them): they are data-hr-click / data-hr-change / data-hr-input, run by hr.js
//   • google.script.run is a thin adapter over the signed-in backend call (action "hr"); same method names and arguments
//   • the page no longer runs "firstTimeSetup" on every load (admins use the ตั้งค่าระบบ button); escAttr is quote-safe
/* eslint-disable */
// @ts-nocheck
export function createHrApp($r, google, env) {
var __H = {};
// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
var DEPARTMENTS = ["กลุ่มงานพัฒนาคุณภาพฯ","กลุ่มงานยุทธศาสตร์ฯ","กลุ่มงานโสตฯ","รวมทุกกลุ่มงาน"];
// สำหรับ "สังกัด" ของพนักงานจริงเท่านั้น (ไม่รวม "รวมทุกกลุ่มงาน" ซึ่งใช้แค่ตอนบันทึก/กรองรายการ)
var REAL_DEPARTMENTS = DEPARTMENTS.slice(0, 3);
var DEPT_DOT_COLORS = ["#3758f9","#0b7a7c","#d97706","#7c3aed"];
var PALETTE = [
  "#c4623d","#7a8a6f","#6f8299","#cf9749",
  "#a8412a","#8c6f4a","#5f7a6b","#4f6b7a",
  "#b4823f","#935e3f","#6b5c47","#8a5a63"
];
var LEAVE_CATS = [
  "ลากิจ","ลากิจครึ่งวัน","ลาป่วย","ลาป่วยครึ่งวัน",
  "ลาพักผ่อน","ลาพักผ่อนครึ่งวัน","ลาไปเรียน"
];
// ประเภทที่ถือว่า "ออกนอกพื้นที่ / มีภารกิจ" — แสดงช่องจังหวัด + ภารกิจ
var OUT_OF_AREA_TYPES = ["ไปราชการ","อบรม","ประชุม","ประชุม P4P","ประชุม กกบ.","ประชุม HR","ประชุมภาพลักษณ์","ประชุม IRB","ประชุม SMC","ประชุมอื่นๆ","งานภายใน/ภายนอก","Event พิเศษ"];
// ลาพักผ่อน — ทำกรอบเด่นชัดบนปฏิทิน เพื่อดูง่ายว่าใครไม่อยู่
var VACATION_TYPES = ["ลาพักผ่อน","ลาพักผ่อนครึ่งวัน"];
var THAI_PROVINCES = [
  "กรุงเทพมหานคร","กระบี่","กาญจนบุรี","กาฬสินธุ์","กำแพงเพชร","ขอนแก่น","จันทบุรี","ฉะเชิงเทรา",
  "ชลบุรี","ชัยนาท","ชัยภูมิ","ชุมพร","เชียงราย","เชียงใหม่","ตรัง","ตราด","ตาก","นครนายก",
  "นครปฐม","นครพนม","นครราชสีมา","นครศรีธรรมราช","นครสวรรค์","นนทบุรี","นราธิวาส","น่าน",
  "บึงกาฬ","บุรีรัมย์","ปทุมธานี","ประจวบคีรีขันธ์","ปราจีนบุรี","ปัตตานี","พระนครศรีอยุธยา",
  "พะเยา","พังงา","พัทลุง","พิจิตร","พิษณุโลก","เพชรบุรี","เพชรบูรณ์","แพร่","ภูเก็ต",
  "มหาสารคาม","มุกดาหาร","แม่ฮ่องสอน","ยโสธร","ยะลา","ร้อยเอ็ด","ระนอง","ระยอง","ราชบุรี",
  "ลพบุรี","ลำปาง","ลำพูน","เลย","ศรีสะเกษ","สกลนคร","สงขลา","สตูล","สมุทรปราการ",
  "สมุทรสงคราม","สมุทรสาคร","สระแก้ว","สระบุรี","สิงห์บุรี","สุโขทัย","สุพรรณบุรี",
  "สุราษฎร์ธานี","สุรินทร์","หนองคาย","หนองบัวลำภู","อ่างทอง","อำนาจเจริญ","อุดรธานี",
  "อุตรดิตถ์","อุทัยธานี","อุบลราชธานี"
];

// [แก้ไข] วันหยุดโหลดจาก server จริง (getHolidayMap) ผ่าน loadHolidays()
// เก็บ default ไว้เพียงเล็กน้อยไว้กันพังกรณีโหลดจาก server ไม่ทัน/พลาด
// (ที่มาของข้อมูลจริง = Sheet "HolidayOverrides" + ค่าคงที่ THAI_HOLIDAYS_GS ฝั่งเซิร์ฟเวอร์)
var THAI_HOLIDAYS = {};

// สถานะโปรเจค — ต้องตรงกับ PROJECT_STATUSES ฝั่ง Code.gs
var PROJECT_STATUSES = ["วางแผน","กำลังพัฒนา","ทดสอบ/รีวิว","ใช้งานจริง","ดูแลรักษา","พักไว้"];
var PROJECT_STATUS_COLORS = {
  "วางแผน":        "#8b8178",
  "กำลังพัฒนา":     "#6f8299",
  "ทดสอบ/รีวิว":    "#cf9749",
  "ใช้งานจริง":     "#7a8a6f",
  "ดูแลรักษา":      "#935e3f",
  "พักไว้":         "#a8412a"
};

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
var staffList      = [];
var allEvents      = [];
var selectedName   = "";
var selectedDept   = "";
var calendar       = null;
var calRO          = null;
var overLimitDates = [];
var currentEventId = "";
var deptFilter     = "all";
var selectedColor  = PALETTE[0];
var currentView    = "dayGridMonth";
var holEditMode    = false; // true = แก้ไข, false = เพิ่ม
var dlogEditMode   = false; // true = แก้ไข, false = เพิ่ม
var projEditMode   = false; // true = แก้ไข, false = เพิ่ม
var dlogRawData    = [];    // cache สำหรับ filter บันทึกประจำวัน
var projectListCache = [];  // cache รายชื่อโปรเจค (ใช้เติม dropdown ในบันทึกประจำวัน)

// ─────────────────────────────────────────────
// DOM READY
// ─────────────────────────────────────────────
function hrInit() {
  var todayObj = new Date();
  var today = todayObj.getFullYear() + '-' + String(todayObj.getMonth()+1).padStart(2,'0') + '-' + String(todayObj.getDate()).padStart(2,'0');
  $r.getElementById('fDate').value    = today;
  $r.getElementById('fEndDate').value = today;
  $r.getElementById('dateJump').value = today;

  var now = new Date();
  $r.getElementById('rYear').value  = now.getFullYear() + 543;
  $r.getElementById('rMonth').value = now.getMonth() + 1;

  buildSwatches();
  buildProvinceList();

  var timeConfig = {
    enableTime: true, noCalendar: true, dateFormat: "H:i",
    time_24hr: true, minuteIncrement: 5, allowInput: true
  };
  flatpickr($r.getElementById('fStart'), hrFp(timeConfig));
  flatpickr($r.getElementById('fEnd'), hrFp(timeConfig));

  // โหลดวันหยุดจาก server ก่อน แล้วค่อยโหลดพนักงาน/ปฏิทิน
  // เพื่อให้ปฏิทินเห็นวันหยุดที่ถูกต้องตั้งแต่ครั้งแรกที่ render
  loadHolidays(function() {
    loadStaff(function() { loadAll(); });
  });


  $r.addEventListener('click', function(e) {
    if (!e.target.closest('.ac-wrap')) $r.getElementById('acDrop').classList.remove('open');
    if (!e.target.closest('.menu-wrap')) closeAllMenus();
    if (!e.target.closest('.combo-wrap')) closeAllCombos();
  });
  $r.getElementById('fName').addEventListener('input', onNameInput);
  try { onTypeChange(); } catch (e) { setTimeout(onTypeChange, 200); }
}

// ─────────────────────────────────────────────
// HOLIDAYS (โหลดจาก server ครั้งแรก)
// ─────────────────────────────────────────────
function loadHolidays(callback) {
  google.script.run
    .withSuccessHandler(function(map) {
      THAI_HOLIDAYS = map || {};
      if (callback) callback();
    })
    .withFailureHandler(function(e) {
      console.error("โหลดวันหยุดไม่สำเร็จ:", e);
      if (callback) callback(); // ยังเปิดระบบต่อได้แม้โหลดวันหยุดไม่สำเร็จ
    })
    .getHolidayMap();
}

// ─────────────────────────────────────────────
// COLOR SWATCHES
// ─────────────────────────────────────────────
function buildProvinceList() {
  var opts = THAI_PROVINCES.map(function(p){ return '<option value="' + p + '">'; }).join('');
  var dl = $r.getElementById('provinceDatalist');
  if (dl) dl.innerHTML = opts;
}

function buildSwatches() {
  var wrap = $r.getElementById('colorSwatches');
  wrap.innerHTML = "";
  PALETTE.forEach(function(c, i) {
    var el = document.createElement('div');
    el.className = 'swatch' + (i === 0 ? ' selected' : '');
    el.style.background = c;
    el.onclick = function() {
      $r.querySelectorAll('.swatch').forEach(function(s){ s.classList.remove('selected'); });
      el.classList.add('selected');
      selectedColor = c;
      $r.getElementById('sColor').value = c;
    };
    wrap.appendChild(el);
  });
}

// ─────────────────────────────────────────────
// LOAD STAFF
// ─────────────────────────────────────────────
function loadStaff(callback) {
  google.script.run
    .withSuccessHandler(function(data) {
      staffList = data;
      renderStaffTable();
      if (callback) callback();
    })
    .withFailureHandler(function(err) {
      showToast("โหลดข้อมูลพนักงานไม่สำเร็จ", "error");
      if (callback) callback();
    })
    .getStaffList();
}

function renderStaffTable() {
  var tbody = $r.getElementById('staffBody');
  if (!staffList.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">ยังไม่มีข้อมูลพนักงาน</td></tr>';
    return;
  }
  tbody.innerHTML = staffList.map(function(s) {
    var dIdx = DEPARTMENTS.indexOf(s.department);
    var dotC = dIdx >= 0 ? DEPT_DOT_COLORS[dIdx] : "#c7bfb3";
    var col  = s.color || getAutoColor(s.name);
    var deptOptions = REAL_DEPARTMENTS.map(function(d) {
      return '<option value="' + esc(d) + '"' + (d === s.department ? ' selected' : '') + '>' + esc(d) + '</option>';
    }).join('');
    return '<tr><td><div class="avatar-cell">' +
      '<div class="avatar-sm" style="background:' + esc(col) + '">' + esc(s.name.charAt(0)) +
      '<div class="dept-dot-sm" style="background:' + esc(dotC) + '"></div></div>' +
      '<button type="button" class="staff-name-link" title="ดูประวัติการบันทึกของ ' + esc(s.name) + '" ' +
      'aria-label="ดูประวัติการบันทึกของ ' + esc(s.name) + '" ' +
      'data-hr-click="openStaffHistory(\'' + escAttr(s.name) + '\')">' + esc(s.name) + '</button>' +
      '</div></td><td>' +
      '<select class="inline-dept-select" aria-label="กลุ่มงานของ ' + esc(s.name) + '" data-hr-change="changeStaffDept(\'' + escAttr(s.name) + '\',this.value)">' +
      deptOptions + '</select></td>' +
      '<td style="text-align:center">' +
      '<input type="color" class="staff-color-input" aria-label="สีประจำตัวของ ' + esc(s.name) + '" ' +
      'value="' + esc(col) + '" data-hr-change="changeStaffColor(\'' + escAttr(s.name) + '\',this.value)">' +
      '</td>' +
      '<td style="text-align:center"><button class="btn-del" aria-label="ลบ ' + esc(s.name) + '" data-hr-click="deleteStaff(\'' + escAttr(s.name) + '\')">ลบ</button></td></tr>';
  }).join('');
}

// ─────────────────────────────────────────────
// LOAD ALL
// ─────────────────────────────────────────────
function applyDashboard(d) {
  d = d || {};
  var c = d.counts || {};
  var leaveTotal   = (c["ลากิจ"]||0)+(c["ลากิจครึ่งวัน"]||0)+(c["ลาป่วย"]||0)+
    (c["ลาป่วยครึ่งวัน"]||0)+(c["ลาพักผ่อน"]||0)+(c["ลาพักผ่อนครึ่งวัน"]||0)+(c["ลาไปเรียน"]||0);
  var meetingTotal = (c["ประชุม"]||0)+(c["ประชุม P4P"]||0)+(c["ประชุม กกบ."]||0)+(c["ประชุม HR"]||0)+
    (c["ประชุมภาพลักษณ์"]||0)+(c["ประชุม IRB"]||0)+(c["ประชุม SMC"]||0)+(c["ประชุมอื่นๆ"]||0);
  $r.getElementById('stLa').textContent      = leaveTotal;
  $r.getElementById('stPrachum').textContent = meetingTotal;
  $r.getElementById('stRat').textContent     = c["ไปราชการ"] || 0;
  $r.getElementById('stOb').textContent      = c["อบรม"]     || 0;
  overLimitDates = d.overLimitDates || [];
  // sync holidays จาก server ถ้ามี
  if (d.holidays) { THAI_HOLIDAYS = d.holidays; }
}
function applyEvents(events) {
  allEvents = events || [];
  renderCalendar();
  renderRecentList();
  hideLoading();
}
// one round trip for dashboard + events (the server reads the sheet once). The first call after boot() is answered from the seed.
function loadAll() {
  google.script.run
    .withSuccessHandler(function(r) {
      if (r && r.dashboard) applyDashboard(r.dashboard);
      applyEvents(r && r.events);
    })
    .withFailureHandler(function(err) {
      hideLoading();
      showToast("โหลดปฏิทินไม่สำเร็จ", "error");
    })
    .getAll();
}
// fresh boot() data arrived after the screen was painted from the cached copy → refresh what is shown (form fields are left alone)
function hrHydrate(b) {
  if (!b) return;
  if (b.holidays) THAI_HOLIDAYS = b.holidays;
  if (b.staff) { staffList = b.staff; renderStaffTable(); }
  if (b.dashboard) applyDashboard(b.dashboard);
  if (b.events) applyEvents(b.events);
}

// ─────────────────────────────────────────────
// CALENDAR
// ─────────────────────────────────────────────
function getHolidayEvents() {
  return Object.keys(THAI_HOLIDAYS).map(function(dateStr) {
    return {
      id: 'hol_' + dateStr, title: '🔴 ' + THAI_HOLIDAYS[dateStr],
      start: dateStr, allDay: true, display: 'background',
      backgroundColor: 'rgba(224,36,36,0.07)', borderColor: 'transparent',
      classNames: ['holiday-event'],
      extendedProps: { isHoliday: true, holidayName: THAI_HOLIDAYS[dateStr] }
    };
  });
}
function getHolidayLabelEvents() {
  return Object.keys(THAI_HOLIDAYS).map(function(dateStr) {
    return {
      id: 'hollabel_' + dateStr, title: '🔴 ' + THAI_HOLIDAYS[dateStr],
      start: dateStr, allDay: true, display: 'auto',
      backgroundColor: 'rgba(150,56,35,0.08)', borderColor: '#963823', textColor: '#963823',
      classNames: ['holiday-label-event'],
      extendedProps: { isHoliday: true, holidayName: THAI_HOLIDAYS[dateStr] }
    };
  });
}
function getFilteredEvents() {
  var combined = getHolidayEvents().concat(getHolidayLabelEvents());
  if (deptFilter === 'all') return allEvents.concat(combined);
  var deptName = DEPARTMENTS[deptFilter];
  return allEvents.filter(function(e){ return e.extendedProps && e.extendedProps.department === deptName; }).concat(combined);
}

// ─────────────────────────────────────────────
// RECENT RECORDS (รายการล่าสุด)
// ─────────────────────────────────────────────
function renderRecentList() {
  var box = $r.getElementById('recentList');
  if (!box) return;

  var items = allEvents.filter(function(e){ return e.extendedProps && !e.extendedProps.isHoliday; });
  items.sort(function(a, b){
    return (b.extendedProps.createdAt || 0) - (a.extendedProps.createdAt || 0);
  });
  items = items.slice(0, 15);

  if (!items.length) {
    box.innerHTML = '<div class="recent-empty">ยังไม่มีรายการ</div>';
    return;
  }

  box.innerHTML = items.map(function(e){
    var ep = e.extendedProps;
    var dIdx = DEPARTMENTS.indexOf(ep.department);
    var dotC = dIdx >= 0 ? DEPT_DOT_COLORS[dIdx] : '#c7bfb3';
    var isVac = VACATION_TYPES.indexOf(ep.type) >= 0;
    var dateDisplay = thaiDate(ep.startDate) + (ep.endDate && ep.endDate !== ep.startDate ? ' – ' + thaiDate(ep.endDate) : '');
    var subParts = [ep.department || ''];
    if (ep.province) subParts.push('📍 ' + ep.province);
    if (ep.mission) subParts.push('🎯 ' + ep.mission);
    return '<div class="recent-item" data-hr-click="openRecentItem(\'' + escAttr(ep.recordId||'') + '\')">' +
      '<div class="recent-item-dot" style="background:' + esc(dotC) + '"></div>' +
      '<div class="recent-item-main">' +
        '<div class="recent-item-top">' + esc(ep.name||'') +
          (isVac ? '<span class="recent-item-vac">🌴 ลาพักผ่อน</span>' : '<span class="type-tag" style="font-size:10.5px;">' + esc(ep.type||'') + '</span>') +
        '</div>' +
        '<div class="recent-item-sub">' + esc(dateDisplay + (subParts.filter(Boolean).length ? ' · ' + subParts.filter(Boolean).join(' · ') : '')) + '</div>' +
      '</div>' +
      '<div class="recent-item-when">' + esc(timeAgo(ep.createdAt)) + '</div>' +
    '</div>';
  }).join('');
}
function openRecentItem(recordId) {
  var e = allEvents.find(function(ev){ return ev.extendedProps && ev.extendedProps.recordId === recordId; });
  if (!e) return;
  showEventModal(recordId, e.title, e.extendedProps);
}

function renderCalendar() {
  var calEl    = $r.getElementById('calendar');
  var isMobile = window.innerWidth < 640;
  var events   = getFilteredEvents();

  if (calendar) {
    calendar.removeAllEvents();
    events.forEach(function(e){ calendar.addEvent(e); });
    calendar.render();
    return;
  }

  // FullCalendar only listens to window resize: also follow the panel itself (scrollbar appears, page padding changes, panel shown again)
  if (window.ResizeObserver && !calRO && calEl.parentNode) {
    var roTimer = null;
    calRO = new ResizeObserver(function() { clearTimeout(roTimer); roTimer = setTimeout(function() { if (calendar) calendar.updateSize(); }, 60); });
    calRO.observe(calEl.parentNode);
  }
  calendar = new FullCalendar.Calendar(calEl, {
    initialView: isMobile ? 'listWeek' : 'dayGridMonth',
    height: isMobile ? 'auto' : 'max(560px, calc(100vh - 360px))',
    locale: 'th', firstDay: 1, hiddenDays: [0, 6],
    events: events,
    slotMinTime: '07:00:00', slotMaxTime: '19:00:00',
    slotDuration: '00:30:00', slotLabelInterval: '01:00',
    allDaySlot: true, slotEventOverlap: true, eventMaxStack: 4,
    nowIndicator: true, eventMinHeight: 28,
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    slotLabelContent: function(arg){ return arg.text.replace('24:00','00:00'); },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    headerToolbar: {
      left: 'prev,next today', center: 'title',
      right: isMobile ? 'listWeek,timeGridDay' : 'dayGridMonth,timeGridWeek,timeGridDay,listMonth'
    },
    buttonText: { today:'วันนี้', month:'เดือน', week:'สัปดาห์', day:'วัน', list:'รายการ' },

    eventContent: function(arg) {
      var isTimeGrid = arg.view.type === 'timeGridWeek' || arg.view.type === 'timeGridDay';
      var isMonth    = arg.view.type === 'dayGridMonth';
      var ep = arg.event.extendedProps;
      var name = esc(ep ? (ep.name || '') : '');

      if (ep && ep.isHoliday) {
        return { html: '<div class="fc-event-title" style="font-size:10px;">' + esc(arg.event.title) + '</div>' };
      }
      var provinceTag = (ep && ep.province) ? ' 📍' + esc(ep.province) : '';
      var missionTag  = (ep && ep.mission)  ? esc(ep.mission) : '';
      var isVacation  = ep && VACATION_TYPES.indexOf(ep.type) >= 0;
      var typeLabel   = esc(isVacation ? '🌴 ' + (ep.type||'') : (ep.type||''));

      if (isTimeGrid && !arg.event.allDay) {
        var fmt = { hour:'2-digit', minute:'2-digit', hour12:false };
        var ss = arg.event.start ? arg.event.start.toLocaleTimeString('th-TH',fmt) : '';
        var es = arg.event.end   ? arg.event.end.toLocaleTimeString('th-TH',fmt)   : '';
        return { html: '<div style="position:relative;padding:3px 4px;font-size:0.8em;line-height:1.25;overflow:hidden;color:#fff;height:100%;display:flex;flex-direction:column;justify-content:center;">' +
          '<div style="font-size:9px;font-weight:700;opacity:0.85;">' + ss + (es ? ' – ' + es : '') + '</div>' +
          '<div style="font-weight:600;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (name ? name + ' · ' : '') + '<span style="opacity:0.9;font-weight:' + (isVacation?'800':'400') + ';">' + typeLabel + '</span>' + (provinceTag ? '<span style="opacity:0.9;font-weight:400;">' + provinceTag + '</span>' : '') + '</div>' +
          (missionTag ? '<div style="font-size:9px;font-weight:400;opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">🎯 ' + missionTag + '</div>' : '') +
          '</div>' };
      }
      if (isMonth && !arg.event.allDay) {
        var isHalf = ep && ep.isHalfDay;
        var wStyle = isHalf ? 'width:50%;' : 'width:100%;';
        var mStyle = (isHalf && ep.note && ep.note.toLowerCase().indexOf('บ่าย') >= 0) ? 'margin-left:50%;' : '';
        var half   = isHalf ? '<span style="font-size:8px;opacity:0.8;margin-left:3px;">½</span>' : '';
        var color  = hrSafeColor(arg.event.backgroundColor);
        var vacStyle = isVacation ? 'outline:2px dashed rgba(255,253,249,0.9);outline-offset:-3px;font-weight:800;' : '';
        return { html: '<div style="' + wStyle + mStyle + 'background:' + color +
          ';color:#fff;border-radius:3px;padding:2px 6px;font-size:14px;font-weight:500;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;box-sizing:border-box;' + vacStyle + '">' +
          typeLabel + ' · ' + (name||'') + half + provinceTag +
          (missionTag ? '<span style="opacity:0.85;font-weight:400;"> — ' + missionTag + '</span>' : '') + '</div>' };
      }
      return true;
    },

    dayCellDidMount: function(info) {
      var y = info.date.getFullYear();
      var m = String(info.date.getMonth()+1).padStart(2,'0');
      var dt = String(info.date.getDate()).padStart(2,'0');
      var d = y + '-' + m + '-' + dt;
      if (overLimitDates.indexOf(d) >= 0) {
        info.el.style.backgroundColor = 'rgba(207,151,73,0.12)';
        info.el.classList.add('day-over-limit');
      }
      if (THAI_HOLIDAYS[d]) {
        info.el.classList.add('holiday-bg');
        var numEl = info.el.querySelector('.fc-daygrid-day-number');
        if (numEl) { numEl.style.color = '#963823'; numEl.style.fontWeight = '700'; }
        var lbl = document.createElement('div');
        lbl.className = 'holiday-label';
        lbl.textContent = THAI_HOLIDAYS[d];
        var frame = info.el.querySelector('.fc-daygrid-day-frame');
        if (frame) frame.insertBefore(lbl, frame.children[1] || null);
      }
    },

    eventDidMount: function(info) {
      var ep = info.event.extendedProps;
      if (ep && ep.isHoliday) return;
      var isTimeGrid = info.view.type === 'timeGridWeek' || info.view.type === 'timeGridDay';
      if (isTimeGrid && !info.event.allDay) info.el.classList.add('has-time-border');
      if (info.view.type !== 'dayGridMonth') {
        var dIdx = DEPARTMENTS.indexOf(ep.department);
        if (dIdx >= 0) {
          var dot = document.createElement('span');
          dot.className = 'dept-mark';
          dot.style.background = DEPT_DOT_COLORS[dIdx];
          var titleEl = info.el.querySelector('.fc-event-title') || info.el.querySelector('.fc-event-title-container');
          if (titleEl) titleEl.prepend(dot);
        }
      }
      if (ep && ep.isHalfDay) { info.el.classList.add('half-day-event'); info.el.style.opacity = '0.92'; }
      if (ep && VACATION_TYPES.indexOf(ep.type) >= 0) { info.el.classList.add('vacation-event'); }
    },

    eventClick: function(info) {
      var ep = info.event.extendedProps;
      if (ep && ep.isHoliday) { showToast('🔴 ' + ep.holidayName, 'info'); return; }
      showEventModal(ep.recordId || info.event.id, info.event.title, ep);
    },
    viewDidMount: function(info) { currentView = info.view.type; }
  });
  calendar.render();
}

function setDeptFilter(val) {
  deptFilter = val;
  ['deptAll','deptBtn0','deptBtn1','deptBtn2','deptBtn3'].forEach(function(id){
    $r.getElementById(id).classList.remove('active');
  });
  if (val === 'all') $r.getElementById('deptAll').classList.add('active');
  else $r.getElementById('deptBtn' + val).classList.add('active');
  if (calendar) {
    calendar.removeAllEvents();
    getFilteredEvents().forEach(function(e){ calendar.addEvent(e); });
  }
}
function changeView(v) {
  if (!calendar) return;
  calendar.changeView(v); currentView = v;
  var map = { dayGridMonth:'vMonth', timeGridWeek:'vWeek', timeGridDay:'vDay', listWeek:'vList' };
  $r.querySelectorAll('.view-pill-btn').forEach(function(b){ b.classList.remove('active'); });
  var el = $r.getElementById(map[v]);
  if (el) el.classList.add('active');
}
function goToDate(d) { if (calendar && d) calendar.gotoDate(d); }

function goToToday() {
  var now = new Date();
  var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  $r.getElementById('dateJump').value = today;
  if (calendar) calendar.today();
}

// ─────────────────────────────────────────────
// PANEL NAV
// ─────────────────────────────────────────────
function showPanel(name) {
  $r.querySelectorAll('.panel').forEach(function(p){ p.classList.remove('active'); });
  $r.querySelectorAll('.nav-item').forEach(function(b){ b.classList.remove('active'); });
  var p = $r.getElementById(name + 'Panel');
  var n = $r.getElementById('nav-' + name);
  if (p) p.classList.add('active');
  if (n) n.classList.add('active');
  var titles = {
    calendar:'📅 ปฏิทินการปฏิบัติงาน', form:'✏️ บันทึกรายการ',
    staff:'👥 จัดการพนักงาน', report:'📊 รายงานประจำเดือน',
    holidays:'🔴 จัดการวันหยุดราชการ',
    dailylog:'📝 บันทึกประจำวัน', projects:'🗂️ โปรเจคที่ดูแล'
  };
  $r.getElementById('panelTitle').textContent = titles[name] || '';
  var pill = $r.getElementById('calViewPill');
  if (pill) pill.style.display = name === 'calendar' ? '' : 'none';
  if (name === 'calendar' && calendar) setTimeout(function(){ calendar.updateSize(); }, 80);
  if (name === 'staff')    renderStaffTable();
  if (name === 'holidays') loadHolidayPanel();
  if (name === 'dailylog') loadDlogPanel();
  if (name === 'projects') loadProjPanel();
}

// ─────────────────────────────────────────────
// AUTOCOMPLETE
// ─────────────────────────────────────────────
function onNameInput() {
  var q  = this.value.trim().toLowerCase();
  var dd = $r.getElementById('acDrop');
  if (!q) { dd.classList.remove('open'); selectedName = ""; return; }
  var matches = staffList.filter(function(s){ return s.name.toLowerCase().indexOf(q) >= 0; });
  if (!matches.length) { dd.classList.remove('open'); return; }
  dd.innerHTML = matches.slice(0,8).map(function(s) {
    var dIdx = DEPARTMENTS.indexOf(s.department);
    var dotC = dIdx >= 0 ? DEPT_DOT_COLORS[dIdx] : "#c7bfb3";
    var col  = s.color || getAutoColor(s.name);
    return '<div class="ac-item" data-hr-click="selectStaff(\'' + escAttr(s.name) + '\',\'' + escAttr(s.department) + '\')">' +
      '<div class="ac-avatar" style="background:' + esc(col) + '">' + esc(s.name.charAt(0)) +
      '<div class="ac-dot" style="background:' + esc(dotC) + '"></div></div>' +
      '<div><div class="ac-name">' + esc(s.name) + '</div><div class="ac-dept">' + esc(s.department) + '</div></div>' +
      '</div>';
  }).join('');
  dd.classList.add('open');
}
$r.getElementById('fName').addEventListener('input', onNameInput);

function selectStaff(name, dept) {
  selectedName = name; selectedDept = dept;
  $r.getElementById('fName').value = name;
  $r.getElementById('fDept').value = dept;
  selectedDept = dept;
  $r.getElementById('acDrop').classList.remove('open');
  checkQuota();
}
function onDeptChange() { selectedDept = $r.getElementById('fDept').value; checkQuota(); }

// ─────────────────────────────────────────────
// TYPE / HALFDAY
// ─────────────────────────────────────────────
var HALFDAY_SUPPORTED = ["ลากิจ","ลาป่วย","ลาพักผ่อน"];
var HALFDAY_TYPE_MAP = {
  "ลากิจ":    { full:"ลากิจ",    morning:"ลากิจครึ่งวัน",    afternoon:"ลากิจครึ่งวัน"    },
  "ลาป่วย":   { full:"ลาป่วย",   morning:"ลาป่วยครึ่งวัน",   afternoon:"ลาป่วยครึ่งวัน"   },
  "ลาพักผ่อน":{ full:"ลาพักผ่อน",morning:"ลาพักผ่อนครึ่งวัน",afternoon:"ลาพักผ่อนครึ่งวัน"}
};
var currentHalfDayBase = "", currentHalfDayMode = "full";

function onTypeChange() {
  var type = $r.getElementById('fType').value;
  var nonLeave = ["ไปราชการ","อบรม","ประชุม","ประชุม P4P","ประชุม กกบ.","ประชุม HR","ประชุมภาพลักษณ์","ประชุม IRB","ประชุม SMC","ประชุมอื่นๆ"];
  var isNonLeave = nonLeave.indexOf(type) >= 0;
  var isHalfDayType = type.indexOf("ครึ่งวัน") >= 0;
  var isHalfDaySupported = HALFDAY_SUPPORTED.indexOf(type) >= 0;

  var noteEl = $r.getElementById('fNote');
  if (type === "ประชุมอื่นๆ") { noteEl.placeholder = "⚠️ โปรดระบุชื่อการประชุม / หัวข้อ"; noteEl.style.borderColor = "#cf9749"; }
  else { noteEl.placeholder = "ระบุรายละเอียดหรือเหตุผล"; noteEl.style.borderColor = ""; }

  var outGroup = $r.getElementById('outOfAreaGroup');
  outGroup.style.display = OUT_OF_AREA_TYPES.indexOf(type) >= 0 ? '' : 'none';
  if (OUT_OF_AREA_TYPES.indexOf(type) < 0) {
    $r.getElementById('fProvince').value = '';
    $r.getElementById('fMission').value = '';
  }

  var hdGroup = $r.getElementById('halfDayGroup');
  if (isHalfDaySupported) {
    hdGroup.classList.add('show');
    currentHalfDayBase = type;
    setHalfDay('full');
    return;
  } else { hdGroup.classList.remove('show'); currentHalfDayBase = ""; currentHalfDayMode = "full"; }

  $r.getElementById('timeGroup').style.display = '';
  var sd = $r.getElementById('fDate').value;
  if (sd) $r.getElementById('fEndDate').min = sd;
  checkQuota();

  var sTimeEl = $r.getElementById('fStart');
  var eTimeEl = $r.getElementById('fEnd');
  var fpStart = sTimeEl._flatpickr;
  var fpEnd   = eTimeEl._flatpickr;
  var setVal  = function(el, fp, v) { if (fp) fp.setDate(v, true); else el.value = v; };
  if (isHalfDayType) { setVal(sTimeEl, fpStart, "08:00"); setVal(eTimeEl, fpEnd, "12:00"); }
  else if (!isNonLeave && type !== "") { setVal(sTimeEl, fpStart, "08:00"); setVal(eTimeEl, fpEnd, "16:00"); }
}

function setHalfDay(mode) {
  currentHalfDayMode = mode;
  ['hdFull','hdMorn','hdAftn'].forEach(function(id){ $r.getElementById(id).classList.remove('active'); });
  var activeId = { full:'hdFull', morning:'hdMorn', afternoon:'hdAftn' }[mode];
  if (activeId) $r.getElementById(activeId).classList.add('active');

  var sTimeEl = $r.getElementById('fStart');
  var eTimeEl = $r.getElementById('fEnd');
  var fpStart = sTimeEl._flatpickr;
  var fpEnd   = eTimeEl._flatpickr;
  var setVal  = function(el, fp, v) { if (fp) fp.setDate(v, true); else el.value = v; };
  var tg = $r.getElementById('timeGroup');

  if (mode === 'full') { setVal(sTimeEl,fpStart,"08:00"); setVal(eTimeEl,fpEnd,"16:00"); tg.style.display = 'none'; }
  else if (mode === 'morning') { setVal(sTimeEl,fpStart,"08:00"); setVal(eTimeEl,fpEnd,"12:00"); tg.style.display = ''; }
  else { setVal(sTimeEl,fpStart,"13:00"); setVal(eTimeEl,fpEnd,"16:00"); tg.style.display = ''; }

  var sd = $r.getElementById('fDate').value;
  if (sd) $r.getElementById('fEndDate').min = sd;
  checkQuota();
}

function getEffectiveType() {
  var rawType = $r.getElementById('fType').value;
  if (currentHalfDayBase && HALFDAY_TYPE_MAP[currentHalfDayBase]) {
    return HALFDAY_TYPE_MAP[currentHalfDayBase][currentHalfDayMode] || rawType;
  }
  return rawType;
}

function onDateChange() {
  var sd = $r.getElementById('fDate').value;
  var edEl = $r.getElementById('fEndDate');
  if (sd) { edEl.min = sd; if (edEl.value && edEl.value < sd) edEl.value = sd; if (!edEl.value) edEl.value = sd; }
  checkQuota();
}

// ─────────────────────────────────────────────
// QUOTA / HOLIDAY CHECK
// ─────────────────────────────────────────────
function checkQuota() {
  var type      = getEffectiveType();
  var date      = $r.getElementById('fDate').value;
  var notice    = $r.getElementById('quotaNotice');
  var holNotice = $r.getElementById('holidayNotice');
  var holBlock  = $r.getElementById('holidayBlockNotice');
  var submitBtn = $r.getElementById('submitBtn');

  var isLeave   = LEAVE_CATS.indexOf(type) >= 0;
  var isHoliday = date && THAI_HOLIDAYS[date];

  if (isHoliday) { $r.getElementById('holidayMsg').textContent = '🔴 ' + THAI_HOLIDAYS[date] + ' — วันหยุดราชการ'; holNotice.style.display = 'flex'; }
  else { holNotice.style.display = 'none'; }

  if (isLeave && isHoliday) {
    $r.getElementById('holidayBlockMsg').textContent = '🚫 ไม่สามารถลาในวันหยุดราชการ: ' + THAI_HOLIDAYS[date];
    holBlock.style.display = 'flex'; submitBtn.disabled = true; notice.classList.remove('show'); return;
  } else { holBlock.style.display = 'none'; submitBtn.disabled = false; }

  if (!isLeave || !date) { notice.classList.remove('show'); return; }
  if (overLimitDates.indexOf(date) >= 0) {
    $r.getElementById('quotaMsg').textContent = '⚠️ กลุ่มงานนี้มีผู้ลาครบ 3 คนแล้ววันที่เลือก — กรุณาระบุเหตุผลในหมายเหตุ';
    notice.classList.add('show');
  } else { notice.classList.remove('show'); }
}

function onFileSelect(input) {
  var area = $r.getElementById('fileArea'), nameEl = $r.getElementById('fFileName');
  if (input.files && input.files[0]) {
    var f = input.files[0];
    var MAX_MB = 10;
    if (f.size > MAX_MB * 1024 * 1024) {
      showToast('ไฟล์ใหญ่เกิน ' + MAX_MB + ' MB (' + (f.size/1024/1024).toFixed(1) + ' MB)', 'error');
      input.value = '';
      area.classList.remove('has-file'); nameEl.textContent = '';
      return;
    }
    area.classList.add('has-file'); nameEl.textContent = '✓ ' + f.name + ' (' + (f.size/1024).toFixed(0) + ' KB)';
  } else { area.classList.remove('has-file'); nameEl.textContent = ''; }
}

// ─────────────────────────────────────────────
// SUBMIT FORM
// ─────────────────────────────────────────────
async function submitForm() {
  var name  = selectedName || $r.getElementById('fName').value.trim();
  var dept  = $r.getElementById('fDept').value;
  var type  = getEffectiveType();
  var date  = $r.getElementById('fDate').value;
  var note  = $r.getElementById('fNote').value;
  var sTime = $r.getElementById('fStart').value;
  var eTime = $r.getElementById('fEnd').value;
  var province = $r.getElementById('fProvince').value.trim();
  var mission  = $r.getElementById('fMission').value.trim();

  if (!name || !dept || !type || !date) { showToast("กรุณากรอกข้อมูลให้ครบถ้วน (ชื่อ / กลุ่มงาน / ประเภท / วันที่)", "error"); return; }
  if (!sTime) sTime = "08:00";
  if (!eTime) eTime = "16:00";

  var btn = $r.getElementById('submitBtn');
  btn.classList.add('loading');

  var base64 = "", fileName = "", fileMime = "";
  var fileEl = $r.getElementById('fFile');
  if (fileEl.files && fileEl.files[0]) {
    var f = fileEl.files[0]; fileMime = f.type; fileName = f.name;
    base64 = await new Promise(function(res, rej) {
      var r = new FileReader(); r.onload = function(){ res(r.result.split(',')[1]); }; r.onerror = function(){ rej(new Error("อ่านไฟล์ไม่ได้")); }; r.readAsDataURL(f);
    });
  }

  google.script.run
    .withSuccessHandler(function(result) {
      btn.classList.remove('loading'); btn.disabled = false;
      if (result.status === 'success') {
        showToast(result.message, result.overlap ? 'warn' : 'success');
        if (result.workdayWarning) setTimeout(function(){ showToast(result.workdayWarning, 'warn'); }, 800);
        if (result.overlap) {
          var ov = $r.getElementById('overlapNotice');
          $r.getElementById('overlapMsg').textContent = '⚠️ เวลาทับซ้อนกับ: ' + result.overlapDetail;
          ov.style.display = 'flex';
          setTimeout(function(){ ov.style.display = 'none'; }, 8000);
        }
        resetForm(); loadAll(); showPanel('calendar');
      } else {
        showToast(result.message, 'error');
        if (result.overQuota) { $r.getElementById('quotaNotice').classList.add('show'); $r.getElementById('fNote').focus(); }
      }
    })
    .withFailureHandler(function(err) { btn.classList.remove('loading'); btn.disabled = false; showToast("เกิดข้อผิดพลาด: " + (err.message||err), "error"); })
    .saveData({
      name: name, department: dept, type: type, startDate: date,
      endDate: $r.getElementById('fEndDate').value || date,
      startTime: sTime, endTime: eTime, note: note,
      province: province, mission: mission,
      fileBase64: base64, fileName: fileName, fileMime: fileMime
    });
}

function resetForm() {
  selectedName = ""; selectedDept = "";
  ['fName','fNote','fProvince','fMission'].forEach(function(id){ $r.getElementById(id).value = ''; });
  $r.getElementById('outOfAreaGroup').style.display = 'none';
  $r.getElementById('fDept').value = '';
  var fpStart = $r.getElementById('fStart')._flatpickr;
  var fpEnd   = $r.getElementById('fEnd')._flatpickr;
  if (fpStart) fpStart.clear(); else $r.getElementById('fStart').value = '';
  if (fpEnd)   fpEnd.clear();   else $r.getElementById('fEnd').value = '';
  $r.getElementById('fFile').value = '';
  $r.getElementById('fileArea').classList.remove('has-file');
  $r.getElementById('fFileName').textContent = '';
  $r.getElementById('quotaNotice').classList.remove('show');
  $r.getElementById('overlapNotice').style.display = 'none';
  $r.getElementById('holidayBlockNotice').style.display = 'none';
  $r.getElementById('submitBtn').disabled = false;
  $r.getElementById('halfDayGroup').classList.remove('show');
  currentHalfDayBase = ''; currentHalfDayMode = 'full';
  ['hdFull','hdMorn','hdAftn'].forEach(function(id){ $r.getElementById(id).classList.remove('active'); });
  $r.getElementById('hdFull').classList.add('active');
  var todayObj = new Date();
  var today = todayObj.getFullYear() + '-' + String(todayObj.getMonth()+1).padStart(2,'0') + '-' + String(todayObj.getDate()).padStart(2,'0');
  $r.getElementById('fDate').value = today;
  $r.getElementById('fEndDate').value = today;
}

// ─────────────────────────────────────────────
// STAFF
// ─────────────────────────────────────────────
function addStaff() {
  var name  = $r.getElementById('sName').value.trim();
  var dept  = $r.getElementById('sDept').value;
  var color = $r.getElementById('sColor').value || selectedColor;
  if (!name) { showToast("กรอกชื่อพนักงาน","error"); return; }
  google.script.run
    .withSuccessHandler(function(res) {
      if (res.status==='success') { showToast(res.message,'success'); $r.getElementById('sName').value=''; loadStaff(null); }
      else showToast(res.message,'error');
    })
    .withFailureHandler(function(e){ showToast(e.message,'error'); })
    .addStaff(name, dept, color);
}
function deleteStaff(name) {
  if (!confirm('ยืนยันลบ "' + name + '" ออกจากระบบ?')) return;
  google.script.run
    .withSuccessHandler(function(res){ showToast(res.message, res.status==='success'?'success':'error'); if(res.status==='success') loadStaff(null); })
    .withFailureHandler(function(e){ showToast(e.message,'error'); })
    .deleteStaff(name);
}
function changeStaffDept(name, newDept) {
  google.script.run
    .withSuccessHandler(function(res){ showToast(res.message, res.status==='success'?'success':'error'); if(res.status==='success') loadStaff(null); })
    .withFailureHandler(function(e){ showToast(e.message,'error'); })
    .updateStaffDept(name, newDept);
}
function changeStaffColor(name, newColor) {
  google.script.run
    .withSuccessHandler(function(res){
      showToast(res.message, res.status==='success'?'success':'error');
      if (res.status==='success') { loadStaff(null); if (calendar) loadAll(); }
    })
    .withFailureHandler(function(e){ showToast(e.message,'error'); })
    .updateStaffColor(name, newColor);
}

// ─────────────────────────────────────────────
// STAFF HISTORY (ดูประวัติการบันทึกรายบุคคล)
// ─────────────────────────────────────────────
function openStaffHistory(name) {
  $r.getElementById('histModalTitle').textContent = '🕘 ประวัติการบันทึก — ' + name;
  $r.getElementById('histModalBody').innerHTML = '<div class="empty-state" style="padding:30px">กำลังโหลด...</div>';
  $r.getElementById('histModal').classList.add('open');
  google.script.run
    .withSuccessHandler(function(records) { renderStaffHistory(records); })
    .withFailureHandler(function(e) {
      $r.getElementById('histModalBody').innerHTML =
        '<div class="empty-state" style="padding:30px;color:var(--danger)">โหลดไม่สำเร็จ: ' + esc(e.message||'') + '</div>';
    })
    .getRecordsByName(name);
}
function renderStaffHistory(records) {
  var body = $r.getElementById('histModalBody');
  if (!records || !records.length) {
    body.innerHTML = '<div class="empty-state" style="padding:30px">ยังไม่มีประวัติการบันทึก</div>';
    return;
  }
  records.sort(function(a,b){ return (b.startDate||'').localeCompare(a.startDate||''); });
  body.innerHTML = '<div class="hist-list">' + records.map(function(r) {
    var dateStr = thaiDate(r.startDate) + (r.endDate && r.endDate !== r.startDate ? ' – ' + thaiDate(r.endDate) : '');
    var fileBtn = r.file ? '<a href="' + esc(hrSafeUrl(r.file)) + '" target="_blank" rel="noopener" class="hist-file-link">📎 ไฟล์แนบ</a>' : '';
    return '<div class="hist-item">' +
      '<div class="hist-item-top"><span class="type-tag">' + esc(r.type) + '</span><span class="hist-date">' + esc(dateStr) + '</span></div>' +
      (r.province ? '<div class="hist-note">📍 ' + esc(r.province) + '</div>' : '') +
      (r.mission ? '<div class="hist-note">🎯 ' + esc(r.mission) + '</div>' : '') +
      (r.note ? '<div class="hist-note">' + esc(r.note) + '</div>' : '') +
      (fileBtn ? '<div class="hist-file">' + fileBtn + '</div>' : '') +
      '</div>';
  }).join('') + '</div>';
}
function closeHistModal() { $r.getElementById('histModal').classList.remove('open'); }

// ─────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────
var _reportRawData = [];

function loadReport() {
  var yearBE = parseInt($r.getElementById('rYear').value);
  var month  = $r.getElementById('rMonth').value;
  if (!yearBE || yearBE < 2500) { showToast("กรอกปี พ.ศ. ให้ถูกต้อง","error"); return; }
  var yearAD = yearBE - 543;
  var tbody  = $r.getElementById('reportBody');
  tbody.innerHTML = '<tr><td colspan="18" class="empty-state">กำลังโหลด...</td></tr>';
  google.script.run
    .withSuccessHandler(function(data) {
      _reportRawData = data;
      renderReportTable(data);
    })
    .withFailureHandler(function(e){ tbody.innerHTML = '<tr><td colspan="18" class="empty-state">โหลดไม่สำเร็จ</td></tr>'; showToast(e.message,'error'); })
    .getMonthlySummary(yearAD, month);
}

function filterReportTable() {
  var dept   = ($r.getElementById('rDept')   || {}).value || '';
  var search = (($r.getElementById('rSearch') || {}).value || '').trim().toLowerCase();
  var filtered = _reportRawData.filter(function(r) {
    if (dept && r.department !== dept) return false;
    if (search && r.name.toLowerCase().indexOf(search) < 0) return false;
    return true;
  });
  renderReportTable(filtered);
}

function renderReportTable(data) {
  var tbody = $r.getElementById('reportBody');
  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="18" class="empty-state">ไม่มีข้อมูลในเดือนนี้</td></tr>'; return;
  }
  tbody.innerHTML = data.map(function(r) {
    var dIdx = DEPARTMENTS.indexOf(r.department);
    var dotC = dIdx >= 0 ? DEPT_DOT_COLORS[dIdx] : "#c7bfb3";
    var col  = getColorForStaff(r.name);
    return '<tr><td><div class="avatar-cell">' +
      '<div class="avatar-sm" style="background:' + esc(col) + '">' + esc(r.name.charAt(0)) +
      '<div class="dept-dot-sm" style="background:' + esc(dotC) + '"></div></div>' + esc(r.name) +
      '</div></td>' +
      '<td><span class="dept-tag ' + (dIdx>=0?'dept'+(dIdx+1):'dept1') + '">' +
      '<span class="dept-tag-dot" style="background:' + esc(dotC) + '"></span>' + esc(r.department) + '</span></td>' +
      dayCell(r["ลากิจ"],"#8c6f4a") + dayCell(r["ลาป่วย"],"#963823") +
      dayCell(r["ลาพักผ่อน"],"#6f8299") + dayCell(r["ลาไปเรียน"],"#8a5a63") +
      dayCell(r["ไปราชการ"],"#5f7a6b") + dayCell(r["อบรม"],"#4f6b7a") +
      dayCell(r["ประชุม"],"#4a5842") + dayCell(r["ประชุม P4P"],"#6b8a80") +
      dayCell(r["ประชุม กกบ."],"#4f6b7a") +
      dayCell(r["ประชุม HR"],"#6f8299") + dayCell(r["ประชุมภาพลักษณ์"],"#935e3f") +
      dayCell(r["ประชุม IRB"],"#b4823f") + dayCell(r["ประชุม SMC"],"#a8615b") +
      dayCell(r["ประชุมอื่นๆ"],"#6b6459") + dayCell(r["งานภายใน/ภายนอก"],"#b4823f") +
      dayCell(r["Event พิเศษ"],"#a8615b") + '</tr>';
  }).join('');
}

function dayCell(val, color) {
  var n = val || 0;
  var display = n === 0 ? '—' : (Number.isInteger(n) ? n.toString() : n.toFixed(1));
  return '<td style="text-align:center" class="report-num"><span style="' + (n>0?'color:'+color:'color:#c7bfb3') + '">' + display + '</span></td>';
}

// ─────────────────────────────────────────────
// [ใหม่] HOLIDAY MANAGEMENT UI
// ─────────────────────────────────────────────
function loadHolidayPanel() {
  $r.getElementById('holTableWrap').innerHTML =
    '<div class="empty-state" style="padding:40px">กำลังโหลด...</div>';

  google.script.run
    .withSuccessHandler(function(list) { renderHolidayTable(list); })
    .withFailureHandler(function(e) {
      $r.getElementById('holTableWrap').innerHTML =
        '<div class="empty-state" style="padding:40px;color:var(--danger)">โหลดไม่สำเร็จ: ' + esc(e.message||'') + '</div>';
    })
    .getHolidayList();
}

function renderHolidayTable(list) {
  var thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  var thaiDays   = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];

  var today = new Date(); today.setHours(0,0,0,0);

  // group by year
  var byYear = {};
  list.forEach(function(item) {
    var y = item.date.substring(0,4);
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(item);
  });

  var html = '';
  Object.keys(byYear).sort().forEach(function(yr) {
    var items = byYear[yr];
    var yearBE = parseInt(yr) + 543;
    html += '<div class="hol-year-group">';
    html += '<div class="hol-year-label">ปี <span class="hol-year-badge">พ.ศ. ' + yearBE + ' (ค.ศ. ' + yr + ')</span></div>';
    html += '<div class="hol-table-wrap"><table class="hol-table"><thead><tr>' +
      '<th style="width:100px">วันที่</th>' +
      '<th>ชื่อวันหยุด</th>' +
      '<th style="width:120px">ประเภท</th>' +
      '<th style="width:120px;text-align:right">จัดการ</th>' +
      '</tr></thead><tbody>';

    items.forEach(function(item) {
      var d = new Date(item.date);
      var isToday    = d.toDateString() === today.toDateString();
      var isPast     = d < today;
      var dayName    = thaiDays[d.getDay()];
      var dateNum    = d.getDate();
      var monthStr   = thaiMonths[d.getMonth()];
      var isSpecial  = item.name.indexOf('ครม') >= 0 || item.name.indexOf('พิเศษ') >= 0 || item.name.indexOf('ชดเชย') >= 0;

      var rowClass = '';
      if (item.isDeleted) rowClass = 'hol-row-deleted';
      else if (item.isCustom) rowClass = 'hol-row-custom';
      else if (isToday) rowClass = 'hol-row-today';

      var badge = '';
      if (item.isDeleted) badge = '<span class="hol-badge-deleted">ถูกซ่อน</span>';
      else if (item.isCustom) badge = '<span class="hol-badge-custom">กำหนดเอง</span>';
      else if (isSpecial) badge = '<span class="hol-badge-special">กรณีพิเศษ</span>';
      else badge = '<span class="hol-badge-default">ราชการ</span>';

      // action buttons
      var actions = '';
      if (item.isDeleted) {
        // restore
        actions = '<button class="btn-hol-restore" data-hr-click="restoreHoliday(\'' + escAttr(item.date) + '\')">↩ คืนค่า</button>';
      } else {
        actions =
          '<button class="btn-hol-edit" data-hr-click="openHolEditForm(\'' + escAttr(item.date) + '\',\'' + escAttr(item.name) + '\')">✏️ แก้ไข</button> ' +
          '<button class="btn-hol-del" data-hr-click="confirmDeleteHoliday(\'' + escAttr(item.date) + '\',\'' + escAttr(item.name) + '\')">🗑 ลบ</button>';
      }

      html += '<tr class="' + rowClass + '">' +
        '<td>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<div style="width:8px;height:8px;border-radius:50%;background:' + (item.isDeleted?'#c7bfb3':item.isCustom?'#7a8a6f':'#963823') + ';flex-shrink:0"></div>' +
            '<div class="hol-date-info">' +
              '<span style="font-size:15px;font-weight:700;">' + hrDmy(d) + '</span>' +
              '<span class="hol-date-dayname">' + dayName + (isPast && !isToday ? ' · ผ่านแล้ว' : '') + '</span>' +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td>' +
          '<span style="font-size:13px;">' + esc(item.name) + '</span>' +
          (isToday ? ' <span class="hol-today-tag">วันนี้</span>' : '') +
        '</td>' +
        '<td>' + badge + '</td>' +
        '<td><div class="hol-action-btns">' + actions + '</div></td>' +
      '</tr>';
    });

    html += '</tbody></table></div></div>';
  });

  if (!list.length) {
    html = '<div class="empty-state" style="padding:40px">ไม่มีข้อมูล</div>';
  }

  $r.getElementById('holTableWrap').innerHTML = html;
}

// เปิดฟอร์มเพิ่มวันหยุด
function toggleHolAddForm() {
  holEditMode = false;
  $r.getElementById('holFormIcon').textContent = '➕';
  $r.getElementById('holFormTitle').textContent = 'เพิ่มวันหยุดราชการ';
  $r.getElementById('holDate').value = '';
  $r.getElementById('holName').value = '';
  var form = $r.getElementById('holAddForm');
  form.classList.toggle('open');
}
function closeHolAddForm() {
  $r.getElementById('holAddForm').classList.remove('open');
}

// เปิดฟอร์มแก้ไขวันหยุด
function openHolEditForm(dateStr, name) {
  holEditMode = true;
  $r.getElementById('holFormIcon').textContent = '✏️';
  $r.getElementById('holFormTitle').textContent = 'แก้ไขวันหยุด';
  $r.getElementById('holDate').value = dateStr;
  $r.getElementById('holName').value = name;
  $r.getElementById('holAddForm').classList.add('open');
  $r.getElementById('holName').focus();
  // scroll to form
  $r.getElementById('holAddForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// บันทึกวันหยุด (เพิ่ม/แก้ไข)
function submitHoliday() {
  var dateStr = $r.getElementById('holDate').value;
  var name    = $r.getElementById('holName').value.trim();
  if (!dateStr || !name) { showToast("กรุณากรอกวันที่และชื่อวันหยุด","error"); return; }

  google.script.run
    .withSuccessHandler(function(res) {
      showToast(res.message, res.status==='success'?'success':'error');
      if (res.status === 'success') {
        closeHolAddForm();
        loadHolidayPanel();
        // sync THAI_HOLIDAYS map
        syncHolidayMap();
      }
    })
    .withFailureHandler(function(e){ showToast("เกิดข้อผิดพลาด: "+(e.message||e),"error"); })
    .saveHoliday(dateStr, name);
}

// ยืนยันลบวันหยุด
function confirmDeleteHoliday(dateStr, name) {
  if (!confirm('ยืนยันซ่อน/ลบวันหยุด "' + name + '" (' + dateStr + ')?\n\nหากเป็นวันหยุดราชการปกติ จะถูกซ่อน (ไม่ลบถาวร)\nหากเป็นวันหยุดที่เพิ่มเอง จะถูกลบออก')) return;
  google.script.run
    .withSuccessHandler(function(res) {
      showToast(res.message, res.status==='success'?'success':'error');
      if (res.status === 'success') { loadHolidayPanel(); syncHolidayMap(); }
    })
    .withFailureHandler(function(e){ showToast("เกิดข้อผิดพลาด: "+(e.message||e),"error"); })
    .deleteHoliday(dateStr);
}

// คืนค่าวันหยุดที่ถูกซ่อน
function restoreHoliday(dateStr) {
  google.script.run
    .withSuccessHandler(function(res) {
      showToast(res.message, res.status==='success'?'success':'error');
      if (res.status === 'success') { loadHolidayPanel(); syncHolidayMap(); }
    })
    .withFailureHandler(function(e){ showToast("เกิดข้อผิดพลาด: "+(e.message||e),"error"); })
    .restoreHoliday(dateStr);
}

// คืนค่าเริ่มต้นทั้งหมด
function confirmRestoreDefaults() {
  if (!confirm('คืนค่าวันหยุดทั้งหมดกลับเป็นค่าเริ่มต้น?\n\nการดำเนินการนี้จะลบการแก้ไขทั้งหมดออก')) return;
  google.script.run
    .withSuccessHandler(function(res) {
      showToast(res.message, res.status==='success'?'success':'error');
      if (res.status === 'success') { loadHolidayPanel(); syncHolidayMap(); }
    })
    .withFailureHandler(function(e){ showToast("เกิดข้อผิดพลาด: "+(e.message||e),"error"); })
    .restoreDefaultHolidays();
}

// sync holidays map จาก server (เพื่ออัปเดต calendar)
function syncHolidayMap() {
  google.script.run
    .withSuccessHandler(function(map) {
      THAI_HOLIDAYS = map;
      if (calendar) {
        calendar.removeAllEvents();
        getFilteredEvents().forEach(function(e){ calendar.addEvent(e); });
      }
    })
    .withFailureHandler(function(){})
    .getHolidayMap();
}

// ─────────────────────────────────────────────
// GENERIC MENU / COMBOBOX HELPERS
// ปรับจากแพทเทิร์น Share-dropdown และ Autocomplete ที่ให้มา
// ─────────────────────────────────────────────
function toggleMenu(id) {
  var el = $r.getElementById(id);
  var wasOpen = el.classList.contains('open');
  closeAllMenus();
  if (!wasOpen) el.classList.add('open');
}
function closeAllMenus() {
  $r.querySelectorAll('.menu-dropdown').forEach(function(m){ m.classList.remove('open'); });
}
function closeAllCombos() {
  $r.querySelectorAll('.combo-dropdown').forEach(function(m){ m.classList.remove('open'); });
}
// ผูก input ข้อความ + dropdown ให้ทำงานแบบ combobox ค้นหาโปรเจค
function bindProjectCombo(inputId, dropId, onSelect) {
  var input = $r.getElementById(inputId);
  var drop  = $r.getElementById(dropId);
  function render(query) {
    var q = (query || '').trim().toLowerCase();
    var matches = projectListCache.filter(function(p){ return !q || p.name.toLowerCase().indexOf(q) >= 0; });
    if (!matches.length) { drop.classList.remove('open'); return; }
    drop.innerHTML = matches.slice(0, 10).map(function(p) {
      var color = PROJECT_STATUS_COLORS[p.status] || 'var(--text3)';
      return '<div class="combo-item" data-name="' + escAttr(p.name) + '">' +
        '<span class="combo-item-dot" style="background:' + esc(color) + '"></span>' +
        '<span>' + esc(p.name) + '</span></div>';
    }).join('');
    Array.prototype.forEach.call(drop.querySelectorAll('.combo-item'), function(el) {
      el.addEventListener('click', function() {
        input.value = el.getAttribute('data-name');
        drop.classList.remove('open');
        if (onSelect) onSelect(input.value);
      });
    });
    drop.classList.add('open');
  }
  input.addEventListener('focus', function(){ render(input.value); });
  input.addEventListener('input', function(){ render(input.value); if (onSelect) onSelect(input.value); });
}

// ─────────────────────────────────────────────
// DAILY LOG — บันทึกประจำวัน
// ─────────────────────────────────────────────
function loadDlogPanel() {
  $r.getElementById('dlogListWrap').innerHTML =
    '<div class="empty-state" style="padding:40px">กำลังโหลด...</div>';

  // เติมข้อมูลโปรเจคล่าสุดให้ combobox ทั้งฟอร์มเพิ่ม + ตัวกรอง
  google.script.run
    .withSuccessHandler(function(list) {
      projectListCache = list;
      bindProjectCombo('dlogProject', 'dlogProjectDrop');
      bindProjectCombo('dlogFilterProject', 'dlogFilterProjectDrop', function(){ filterDlogTable(); });
    })
    .withFailureHandler(function(){})
    .getProjectList();

  google.script.run
    .withSuccessHandler(function(list) {
      dlogRawData = list;
      renderStreak(list);
      renderDlogTable(list);
    })
    .withFailureHandler(function(e) {
      $r.getElementById('dlogListWrap').innerHTML =
        '<div class="empty-state" style="padding:40px;color:var(--danger)">โหลดไม่สำเร็จ: ' + esc(e.message||'') + '</div>';
    })
    .getDailyLogList();
}

// แถบ 14 วันล่าสุด — ปรับจากแนวคิด calendar/activity heatmap
function renderStreak(list) {
  var loggedDates = {};
  list.forEach(function(item){ loggedDates[item.date] = true; });
  var todayObj = new Date(); todayObj.setHours(0,0,0,0);
  var todayStr = todayObj.getFullYear() + '-' + String(todayObj.getMonth()+1).padStart(2,'0') + '-' + String(todayObj.getDate()).padStart(2,'0');
  var cells = '<span class="dlog-streak-label">14 วันล่าสุด:</span>';
  for (var i = 13; i >= 0; i--) {
    var d = new Date(todayObj); d.setDate(d.getDate() - i);
    var ds = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    var cls = 'streak-cell' + (loggedDates[ds] ? ' has-log' : '') + (ds === todayStr ? ' is-today' : '');
    var title = thaiDateFull(ds) + (loggedDates[ds] ? ' — มีบันทึก' : ' — ไม่มีบันทึก');
    cells += '<div class="' + cls + '" title="' + esc(title) + '"></div>';
  }
  $r.getElementById('dlogStreak').innerHTML = cells;
}

function filterDlogTable() {
  var project = (($r.getElementById('dlogFilterProject') || {}).value || '').trim().toLowerCase();
  var search  = (($r.getElementById('dlogSearch') || {}).value || '').trim().toLowerCase();
  var filtered = dlogRawData.filter(function(r) {
    if (project && r.project.toLowerCase().indexOf(project) < 0) return false;
    if (search && r.detail.toLowerCase().indexOf(search) < 0) return false;
    return true;
  });
  renderDlogTable(filtered);
}

function renderDlogTable(list) {
  var wrap = $r.getElementById('dlogListWrap');
  if (!list.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:40px">ยังไม่มีบันทึก — เริ่มบันทึกงานวันนี้ได้เลย</div>';
    return;
  }

  // group ตามวันที่
  var byDate = {}; var order = [];
  list.forEach(function(item) {
    if (!byDate[item.date]) { byDate[item.date] = []; order.push(item.date); }
    byDate[item.date].push(item);
  });

  var html = '';
  order.forEach(function(dateStr) {
    var items = byDate[dateStr];
    var totalHours = items.reduce(function(sum, it){ return sum + (Number(it.hours) || 0); }, 0);
    html += '<div class="dlog-day-group">';
    html += '<div class="dlog-day-label"><span class="dlog-day-badge">' + esc(thaiDateFull(dateStr)) + '</span>' +
      (totalHours > 0 ? '<span class="dlog-hours-badge">' + totalHours + ' ชม.</span>' : '') + '</div>';

    items.forEach(function(item) {
      var color = PROJECT_STATUS_COLORS[getProjectStatus(item.project)] || 'var(--text3)';
      html += '<div class="dlog-card">' +
        '<div class="dlog-card-top">' +
        (item.project ? '<span class="dlog-proj-pill" style="background:' + esc(color) + '">' + esc(item.project) + '</span>' : '<span class="dlog-proj-pill" style="background:var(--text3)">ทั่วไป</span>') +
        (item.hours ? '<span style="font-size:11px;color:var(--text3)">' + esc(item.hours) + ' ชม.</span>' : '') +
        '<div class="dlog-card-actions">' +
        '<button class="btn-hol-edit" data-hr-click="openDlogEditForm(\'' + escAttr(item.id) + '\')">✏️ แก้ไข</button>' +
        '<button class="btn-hol-del" data-hr-click="confirmDeleteDlog(\'' + escAttr(item.id) + '\')">🗑 ลบ</button>' +
        '</div></div>' +
        '<div class="dlog-detail">' + esc(item.detail) + '</div>' +
        '</div>';
    });
    html += '</div>';
  });

  wrap.innerHTML = html;
}

function getProjectStatus(name) {
  var p = projectListCache.find(function(x){ return x.name === name; });
  return p ? p.status : "";
}

function thaiDateFull(dateStr) {
  if (!dateStr) return '';
  try {
    var thaiDays   = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
    var d = new Date(dateStr);
    return 'วัน' + thaiDays[d.getDay()] + ' ' + hrDmy(d);
  } catch(e){ return dateStr; }
}

function toggleDlogAddForm() {
  dlogEditMode = false;
  $r.getElementById('dlogFormIcon').textContent = '➕';
  $r.getElementById('dlogFormTitle').textContent = 'บันทึกประจำวัน';
  $r.getElementById('dlogId').value = '';
  $r.getElementById('dlogDetail').value = '';
  $r.getElementById('dlogHours').value = '';
  $r.getElementById('dlogProject').value = '';
  var todayObj = new Date();
  $r.getElementById('dlogDate').value =
    todayObj.getFullYear() + '-' + String(todayObj.getMonth()+1).padStart(2,'0') + '-' + String(todayObj.getDate()).padStart(2,'0');
  $r.getElementById('dlogAddForm').classList.toggle('open');
}
function closeDlogAddForm() {
  $r.getElementById('dlogAddForm').classList.remove('open');
  closeAllCombos();
}
function openDlogEditForm(id) {
  var item = dlogRawData.find(function(x){ return x.id === id; });
  if (!item) return;
  dlogEditMode = true;
  $r.getElementById('dlogFormIcon').textContent = '✏️';
  $r.getElementById('dlogFormTitle').textContent = 'แก้ไขบันทึกประจำวัน';
  $r.getElementById('dlogId').value = item.id;
  $r.getElementById('dlogDate').value = item.date;
  $r.getElementById('dlogProject').value = item.project;
  $r.getElementById('dlogHours').value = item.hours;
  $r.getElementById('dlogDetail').value = item.detail;
  $r.getElementById('dlogAddForm').classList.add('open');
  $r.getElementById('dlogAddForm').scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function submitDlog() {
  var form = {
    id:      $r.getElementById('dlogId').value,
    date:    $r.getElementById('dlogDate').value,
    project: $r.getElementById('dlogProject').value.trim(),
    hours:   $r.getElementById('dlogHours').value,
    detail:  $r.getElementById('dlogDetail').value.trim()
  };
  if (!form.date || !form.detail) { showToast("กรุณากรอกวันที่และรายละเอียด","error"); return; }

  var call = google.script.run
    .withSuccessHandler(function(res) {
      showToast(res.message, res.status==='success'?'success':'error');
      if (res.status === 'success') { closeDlogAddForm(); loadDlogPanel(); }
    })
    .withFailureHandler(function(e){ showToast("เกิดข้อผิดพลาด: "+(e.message||e),"error"); });

  if (dlogEditMode) call.updateDailyLog(form); else call.addDailyLog(form);
}
function confirmDeleteDlog(id) {
  if (!confirm('ยืนยันลบบันทึกนี้?')) return;
  google.script.run
    .withSuccessHandler(function(res) {
      showToast(res.message, res.status==='success'?'success':'error');
      if (res.status === 'success') loadDlogPanel();
    })
    .withFailureHandler(function(e){ showToast("เกิดข้อผิดพลาด: "+(e.message||e),"error"); })
    .deleteDailyLog(id);
}

// Export dropdown — ปรับจากแพทเทิร์น Share/Export menu ที่ให้มา
function exportDlogCSV() {
  if (!dlogRawData.length) { showToast("ไม่มีข้อมูลให้ export","error"); return; }
  var rows = [["วันที่","โปรเจค","รายละเอียด","ชั่วโมง"]];
  dlogRawData.forEach(function(r){ rows.push([r.date, r.project, r.detail, r.hours]); });
  downloadCSV(rows, 'daily-log.csv');
}
function copyDlogSummary() {
  if (!dlogRawData.length) { showToast("ไม่มีข้อมูลให้คัดลอก","error"); return; }
  var byDate = {}; var order = [];
  dlogRawData.forEach(function(r){ if(!byDate[r.date]){byDate[r.date]=[];order.push(r.date);} byDate[r.date].push(r); });
  var text = order.map(function(d) {
    var lines = byDate[d].map(function(r){ return '  - ' + (r.project ? '[' + r.project + '] ' : '') + r.detail + (r.hours ? ' (' + r.hours + ' ชม.)' : ''); });
    return thaiDateFull(d) + '\n' + lines.join('\n');
  }).join('\n\n');
  copyToClipboard(text);
}
function downloadCSV(rows, filename) {
  var csv = rows.map(function(row) {
    return row.map(function(cell) {
      var s = String(cell === undefined || cell === null ? '' : cell);
      return '"' + s.replace(/"/g, '""') + '"';
    }).join(',');
  }).join('\r\n');
  var blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function(){ showToast("คัดลอกแล้ว ✓","success"); })
      .catch(function(){ showToast("คัดลอกไม่สำเร็จ","error"); });
  } else {
    var ta = document.createElement('textarea'); ta.value = text;
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast("คัดลอกแล้ว ✓","success"); }
    catch(e){ showToast("คัดลอกไม่สำเร็จ","error"); }
    document.body.removeChild(ta);
  }
}

// ─────────────────────────────────────────────
// PROJECTS — โปรเจคที่ดูแล
// ─────────────────────────────────────────────
var projListRaw = [];
var projViewMode = 'grid'; // 'grid' | 'timeline'

function loadProjPanel() {
  $r.getElementById('projGridWrap').innerHTML =
    '<div class="empty-state" style="padding:40px">กำลังโหลด...</div>';
  var statusOptions = PROJECT_STATUSES.map(function(s){ return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
  $r.getElementById('projStatus').innerHTML = statusOptions;

  google.script.run
    .withSuccessHandler(function(list) {
      projListRaw = list;
      projectListCache = list;
      renderProjCurrentView();
    })
    .withFailureHandler(function(e) {
      $r.getElementById('projGridWrap').innerHTML =
        '<div class="empty-state" style="padding:40px;color:var(--danger)">โหลดไม่สำเร็จ: ' + esc(e.message||'') + '</div>';
    })
    .getProjectList();
}

function renderProjCurrentView() {
  if (projViewMode === 'timeline') renderProjTimeline(projListRaw);
  else renderProjGrid(projListRaw);
}

function toggleProjView() {
  projViewMode = (projViewMode === 'grid') ? 'timeline' : 'grid';
  $r.getElementById('projGridWrap').style.display = (projViewMode === 'grid') ? '' : 'none';
  $r.getElementById('projTimelineWrap').style.display = (projViewMode === 'timeline') ? '' : 'none';
  $r.getElementById('projViewToggleBtn').textContent = (projViewMode === 'timeline') ? '🗂 มุมมองการ์ด' : '📊 มุมมอง Timeline';
  renderProjCurrentView();
}

function renderProjGrid(list) {
  var wrap = $r.getElementById('projGridWrap');
  if (!list.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:40px">ยังไม่มีโปรเจค — กด "เพิ่มโปรเจค" เพื่อเริ่มต้น</div>';
    return;
  }
  var html = '<div class="proj-grid">';
  list.forEach(function(p) {
    var color = PROJECT_STATUS_COLORS[p.status] || 'var(--text3)';
    var progress = Number(p.progress) || 0;
    var dateRange = (p.startDate || p.targetDate)
      ? ('📅 ' + (p.startDate ? thaiDateShort(p.startDate) : '?') + ' → ' + (p.targetDate ? thaiDateShort(p.targetDate) : '?'))
      : '';
    html += '<div class="proj-card">' +
      '<div class="proj-card-head">' +
        '<div><div class="proj-name">' + esc(p.name) + '</div>' +
        (p.url ? '<a class="proj-url" href="' + esc(p.url) + '" target="_blank" rel="noopener">🔗 ' + esc(p.url) + '</a>' : '') +
        '</div>' +
        '<span class="proj-status-badge" style="background:' + esc(color) + '">' + esc(p.status) + '</span>' +
      '</div>' +
      '<div class="proj-progress-wrap">' +
        '<div class="proj-progress-bar"><div class="proj-progress-fill" style="width:' + progress + '%;background:' + esc(color) + '"></div></div>' +
        '<span class="proj-progress-pct">' + progress + '%</span>' +
      '</div>' +
      (dateRange ? '<div class="proj-dates">' + esc(dateRange) + '</div>' : '') +
      (p.nextAction ? '<div class="proj-next"><b>ต้องทำต่อ:</b> ' + esc(p.nextAction) + '</div>' : '') +
      (p.notes ? '<div class="proj-notes">' + esc(p.notes) + '</div>' : '') +
      '<div class="proj-card-actions">' +
      '<button class="btn-hol-edit" data-hr-click="openProjEditForm(\'' + escAttr(p.id) + '\')">✏️ แก้ไข</button>' +
      '<button class="btn-hol-del" data-hr-click="confirmDeleteProj(\'' + escAttr(p.id) + '\')">🗑 ลบ</button>' +
      '</div>' +
    '</div>';
  });
  html += '</div>';
  wrap.innerHTML = html;
}

// ปรับจากแพทเทิร์น Gantt/roadmap ที่ให้มา — ไม่ใช้ไลบรารีภายนอก วาดด้วย div/CSS ล้วน
function renderProjTimeline(list) {
  var wrap = $r.getElementById('projTimelineWrap');
  var withDates = list.filter(function(p){ return p.startDate && p.targetDate; });
  var withoutDates = list.filter(function(p){ return !(p.startDate && p.targetDate); });

  if (!list.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:40px">ยังไม่มีโปรเจค</div>';
    return;
  }
  if (!withDates.length) {
    wrap.innerHTML = '<div class="timeline-empty-note">ยังไม่มีโปรเจคที่ระบุ "เริ่มโปรเจค" และ "กำหนดเสร็จ" — เพิ่มวันที่ในฟอร์มแก้ไขเพื่อดูไทม์ไลน์</div>';
    return;
  }

  // หาช่วงเวลาทั้งหมด แล้วปัดขอบเป็นสัปดาห์เพื่อให้แถบอ่านง่าย
  var minTime = Math.min.apply(null, withDates.map(function(p){ return new Date(p.startDate).getTime(); }));
  var maxTime = Math.max.apply(null, withDates.map(function(p){ return new Date(p.targetDate).getTime(); }));
  var rangeStart = new Date(minTime); rangeStart.setDate(rangeStart.getDate() - 3);
  var rangeEnd   = new Date(maxTime); rangeEnd.setDate(rangeEnd.getDate() + 3);
  var totalMs = rangeEnd.getTime() - rangeStart.getTime();

  var tickCount = 6;
  var ticksHtml = '';
  for (var t = 0; t <= tickCount; t++) {
    var tDate = new Date(rangeStart.getTime() + (totalMs * t / tickCount));
    ticksHtml += '<div class="timeline-tick">' + hrDmy(tDate) + '</div>';
  }

  var rowsHtml = withDates.map(function(p) {
    var s = new Date(p.startDate).getTime();
    var e = new Date(p.targetDate).getTime();
    var leftPct  = Math.max(0, (s - rangeStart.getTime()) / totalMs * 100);
    var widthPct = Math.max(1.5, (e - s) / totalMs * 100);
    var color = PROJECT_STATUS_COLORS[p.status] || 'var(--text3)';
    var progress = Number(p.progress) || 0;
    return '<div class="timeline-row">' +
      '<div class="timeline-row-label" title="' + escAttr(p.name) + '">' + esc(p.name) + '</div>' +
      '<div class="timeline-row-track">' +
        '<div class="timeline-bar" style="left:' + leftPct + '%;width:' + widthPct + '%;background:' + esc(color) + '" title="' + escAttr(p.name + ' — ' + p.status + ' (' + progress + '%)') + '">' +
          '<div class="timeline-bar-fill" style="width:' + (100 - progress) + '%;right:0;left:auto"></div>' +
          '<span class="timeline-bar-label">' + esc(p.name) + ' · ' + progress + '%</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  var html = '<div class="timeline-wrap">' +
    '<div class="timeline-head"><div class="timeline-head-label">โปรเจค</div><div class="timeline-head-track">' + ticksHtml + '</div></div>' +
    rowsHtml +
    '</div>';

  if (withoutDates.length) {
    html += '<div class="timeline-empty-note">ไม่แสดงในไทม์ไลน์ (ยังไม่ระบุวันที่): ' +
      withoutDates.map(function(p){ return esc(p.name); }).join(', ') + '</div>';
  }

  wrap.innerHTML = html;
}

function thaiDateShort(dateStr) {
  if (!dateStr) return '';
  try {
    var d = new Date(dateStr);
    return hrDmy(d);
  } catch(e){ return dateStr; }
}

function toggleProjAddForm() {
  projEditMode = false;
  $r.getElementById('projFormIcon').textContent = '➕';
  $r.getElementById('projFormTitle').textContent = 'เพิ่มโปรเจค';
  $r.getElementById('projId').value = '';
  $r.getElementById('projName').value = '';
  $r.getElementById('projUrl').value = '';
  $r.getElementById('projStatus').value = PROJECT_STATUSES[0];
  $r.getElementById('projStartDate').value = '';
  $r.getElementById('projTargetDate').value = '';
  $r.getElementById('projProgress').value = 0;
  $r.getElementById('projProgressVal').textContent = '0%';
  $r.getElementById('projNextAction').value = '';
  $r.getElementById('projNotes').value = '';
  $r.getElementById('projAddForm').classList.toggle('open');
}
function closeProjAddForm() {
  $r.getElementById('projAddForm').classList.remove('open');
}
function openProjEditForm(id) {
  var p = projListRaw.find(function(x){ return x.id === id; });
  if (!p) return;
  projEditMode = true;
  $r.getElementById('projFormIcon').textContent = '✏️';
  $r.getElementById('projFormTitle').textContent = 'แก้ไขโปรเจค';
  $r.getElementById('projId').value = p.id;
  $r.getElementById('projName').value = p.name;
  $r.getElementById('projUrl').value = p.url;
  $r.getElementById('projStatus').value = p.status;
  $r.getElementById('projStartDate').value = p.startDate || '';
  $r.getElementById('projTargetDate').value = p.targetDate || '';
  $r.getElementById('projProgress').value = p.progress || 0;
  $r.getElementById('projProgressVal').textContent = (p.progress || 0) + '%';
  $r.getElementById('projNextAction').value = p.nextAction;
  $r.getElementById('projNotes').value = p.notes;
  $r.getElementById('projAddForm').classList.add('open');
  $r.getElementById('projAddForm').scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function submitProject() {
  var form = {
    id:         $r.getElementById('projId').value,
    name:       $r.getElementById('projName').value.trim(),
    url:        $r.getElementById('projUrl').value.trim(),
    status:     $r.getElementById('projStatus').value,
    startDate:  $r.getElementById('projStartDate').value,
    targetDate: $r.getElementById('projTargetDate').value,
    progress:   $r.getElementById('projProgress').value,
    nextAction: $r.getElementById('projNextAction').value.trim(),
    notes:      $r.getElementById('projNotes').value.trim()
  };
  if (!form.name) { showToast("กรุณากรอกชื่อโปรเจค","error"); return; }

  var call = google.script.run
    .withSuccessHandler(function(res) {
      showToast(res.message, res.status==='success'?'success':'error');
      if (res.status === 'success') { closeProjAddForm(); loadProjPanel(); }
    })
    .withFailureHandler(function(e){ showToast("เกิดข้อผิดพลาด: "+(e.message||e),"error"); });

  if (projEditMode) call.updateProject(form); else call.addProject(form);
}
function confirmDeleteProj(id) {
  if (!confirm('ยืนยันลบโปรเจคนี้? (บันทึกประจำวันที่อ้างอิงถึงจะไม่ถูกลบ)')) return;
  google.script.run
    .withSuccessHandler(function(res) {
      showToast(res.message, res.status==='success'?'success':'error');
      if (res.status === 'success') loadProjPanel();
    })
    .withFailureHandler(function(e){ showToast("เกิดข้อผิดพลาด: "+(e.message||e),"error"); })
    .deleteProject(id);
}

// Export dropdown — ปรับจากแพทเทิร์น Share/Export menu ที่ให้มา
function exportProjCSV() {
  if (!projListRaw.length) { showToast("ไม่มีข้อมูลให้ export","error"); return; }
  var rows = [["ชื่อโปรเจค","URL","สถานะ","เริ่ม","กำหนดเสร็จ","ความคืบหน้า(%)","ต้องทำต่อ","หมายเหตุ"]];
  projListRaw.forEach(function(p){
    rows.push([p.name, p.url, p.status, p.startDate, p.targetDate, p.progress, p.nextAction, p.notes]);
  });
  downloadCSV(rows, 'projects.csv');
}
function copyProjSummary() {
  if (!projListRaw.length) { showToast("ไม่มีข้อมูลให้คัดลอก","error"); return; }
  var text = projListRaw.map(function(p) {
    return p.name + ' — ' + p.status + ' (' + (p.progress||0) + '%)' +
      (p.nextAction ? '\n  ต้องทำต่อ: ' + p.nextAction : '');
  }).join('\n\n');
  copyToClipboard(text);
}

// ─────────────────────────────────────────────
// EDIT MODAL
// ─────────────────────────────────────────────
var currentEditEp = null;

// Flatpickr instances for edit modal — init once lazily
var _editFpStart = null, _editFpEnd = null;
function ensureEditFlatpickr() {
  var tcfg = { enableTime:true, noCalendar:true, dateFormat:"H:i", time_24hr:true, minuteIncrement:5, allowInput:true };
  if (!_editFpStart) _editFpStart = flatpickr($r.getElementById('editStartTime'), hrFp(tcfg));
  if (!_editFpEnd)   _editFpEnd   = flatpickr($r.getElementById('editEndTime'), hrFp(tcfg));
}

function openEditModal(ep) {
  currentEditEp = ep;
  closeModal();
  ensureEditFlatpickr();
  $r.getElementById('editId').value        = ep.recordId || '';
  $r.getElementById('editName').value      = ep.name || '';
  $r.getElementById('editDept').value      = ep.department || '';
  $r.getElementById('editType').value      = ep.type || '';
  $r.getElementById('editStartDate').value = ep.startDate || '';
  $r.getElementById('editEndDate').value   = ep.endDate || ep.startDate || '';
  // set Flatpickr values
  if (_editFpStart) _editFpStart.setDate(ep.startTime || '', true); else $r.getElementById('editStartTime').value = ep.startTime || '';
  if (_editFpEnd)   _editFpEnd.setDate(ep.endTime   || '', true); else $r.getElementById('editEndTime').value   = ep.endTime   || '';
  $r.getElementById('editNote').value      = (ep.note||'').replace(/^⚠️ เกินโควต้า: /,'');
  $r.getElementById('editProvince').value  = ep.province || '';
  $r.getElementById('editMission').value   = ep.mission || '';
  $r.getElementById('editOutOfAreaGroup').style.display = OUT_OF_AREA_TYPES.indexOf(ep.type) >= 0 ? '' : 'none';
  $r.getElementById('editFileUrl').value   = ep.file || '';
  $r.getElementById('editFileName').textContent = ep.file ? '📎 มีไฟล์แนบอยู่แล้ว' : '';
  $r.getElementById('editFileArea').classList.remove('has-file');
  $r.getElementById('editFile').value = '';
  $r.getElementById('editModal').classList.add('open');
}
function closeEditModal() { $r.getElementById('editModal').classList.remove('open'); currentEditEp = null; }
function onEditTypeChange() {
  var type = $r.getElementById('editType').value;
  var grp = $r.getElementById('editOutOfAreaGroup');
  grp.style.display = OUT_OF_AREA_TYPES.indexOf(type) >= 0 ? '' : 'none';
  if (OUT_OF_AREA_TYPES.indexOf(type) < 0) {
    $r.getElementById('editProvince').value = '';
    $r.getElementById('editMission').value = '';
  }
}
function onEditFileSelect(input) {
  var nameEl = $r.getElementById('editFileName'), area = $r.getElementById('editFileArea');
  if (input.files && input.files[0]) {
    var f = input.files[0];
    var MAX_MB = 10;
    if (f.size > MAX_MB * 1024 * 1024) {
      showToast('ไฟล์ใหญ่เกิน ' + MAX_MB + ' MB', 'error');
      input.value = ''; area.classList.remove('has-file'); nameEl.textContent = ''; return;
    }
    area.classList.add('has-file'); nameEl.textContent = '✓ ' + f.name + ' (' + (f.size/1024).toFixed(0) + ' KB)';
  } else { area.classList.remove('has-file'); nameEl.textContent = ''; }
}
async function submitEdit() {
  var id = $r.getElementById('editId').value;
  var name = $r.getElementById('editName').value.trim();
  var dept = $r.getElementById('editDept').value;
  var type = $r.getElementById('editType').value;
  var startDate = $r.getElementById('editStartDate').value;
  var endDate   = $r.getElementById('editEndDate').value || startDate;
  var startTime = $r.getElementById('editStartTime').value;
  var endTime   = $r.getElementById('editEndTime').value;
  var note      = $r.getElementById('editNote').value;
  var province  = $r.getElementById('editProvince').value.trim();
  var mission   = $r.getElementById('editMission').value.trim();
  var fileUrl   = $r.getElementById('editFileUrl').value;

  if (!id || !name || !type || !startDate) { showToast("กรอกข้อมูลไม่ครบ","error"); return; }

  var btn = $r.getElementById('editSaveBtn');
  btn.disabled = true; btn.textContent = '⏳ กำลังบันทึก...';

  var base64='', fileName='', fileMime='';
  var fileEl = $r.getElementById('editFile');
  if (fileEl.files && fileEl.files[0]) {
    var f = fileEl.files[0]; fileMime = f.type; fileName = f.name;
    base64 = await new Promise(function(res, rej) {
      var r = new FileReader(); r.onload = function(){ res(r.result.split(',')[1]); }; r.onerror = function(){ rej(new Error("อ่านไฟล์ไม่ได้")); }; r.readAsDataURL(f);
    });
  }

  google.script.run
    .withSuccessHandler(function(result) {
      btn.disabled = false; btn.textContent = '💾 บันทึกการแก้ไข';
      if (result.status==='success') {
        showToast(result.message,'success');
        if (result.workdayWarning) setTimeout(function(){ showToast(result.workdayWarning,'warn'); }, 600);
        closeEditModal(); loadAll();
      } else { showToast(result.message,'error'); }
    })
    .withFailureHandler(function(e){ btn.disabled = false; btn.textContent = '💾 บันทึกการแก้ไข'; showToast("เกิดข้อผิดพลาด: "+(e.message||e),"error"); })
    .updateRecord({ id, name, department: dept, type, startDate, endDate, startTime, endTime, note, province, mission, fileUrl, fileBase64: base64, fileName, fileMime });
}

// ─────────────────────────────────────────────
// EVENT MODAL
// ─────────────────────────────────────────────
function showEventModal(id, title, ep) {
  currentEventId = ep.recordId || id || "";
  var dIdx = DEPARTMENTS.indexOf(ep.department);
  var dotC = dIdx >= 0 ? DEPT_DOT_COLORS[dIdx] : "#c7bfb3";
  $r.getElementById('evModalTitle').textContent = ep.type + ' — ' + ep.name;

  var timeStr = "";
  if (ep.startTime && ep.endTime) timeStr = ep.startTime + ' – ' + ep.endTime + ' น.';
  else if (ep.startTime) timeStr = ep.startTime + ' น.';
  else if (ep.isHalfDay) timeStr = 'ครึ่งวัน';

  var dateDisplay = thaiDate(ep.startDate);
  if (ep.endDate && ep.endDate !== ep.startDate) dateDisplay = thaiDate(ep.startDate) + ' – ' + thaiDate(ep.endDate);

  $r.getElementById('evModalBody').innerHTML =
    mRow('👤','ชื่อ',esc(ep.name)) +
    mRow('🏢','กลุ่มงาน','<span class="dept-tag ' + (dIdx>=0?'dept'+(dIdx+1):'dept1') + '"><span class="dept-tag-dot" style="background:' + esc(dotC) + '"></span>' + esc(ep.department) + '</span>') +
    mRow('🏷️','ประเภท','<span class="type-tag">' + esc(ep.type) + '</span>') +
    mRow('📅','ช่วงวันที่',dateDisplay) +
    (timeStr ? mRow('🕐','เวลา',timeStr) : '') +
    (ep.province ? mRow('📍','จังหวัด',esc(ep.province)) : '') +
    (ep.mission ? mRow('🎯','ภารกิจ',esc(ep.mission)) : '') +
    (ep.note ? mRow('📝','หมายเหตุ',esc(ep.note)) : '');

  var foot = $r.getElementById('evModalFoot');
  foot.innerHTML = '';
  if (ep.file) {
    var fb = document.createElement('button'); fb.className = 'btn-modal-file'; fb.textContent = '📎 เปิดไฟล์แนบ';
    fb.onclick = function(){ hrOpenUrl(ep.file); }; foot.appendChild(fb);
  }
  if (currentEventId && ep.canEdit !== false) {
    var eb = document.createElement('button'); eb.className = 'btn-modal-edit'; eb.textContent = '✏️ แก้ไข';
    eb.onclick = function(){ openEditModal(ep); }; foot.appendChild(eb);
    var db = document.createElement('button'); db.className = 'btn-modal-del'; db.textContent = '🗑 ลบรายการ';
    db.onclick = function(){ deleteEventRecord(); }; foot.appendChild(db);
  }
  $r.getElementById('evModal').classList.add('open');
}
function mRow(icon, label, val) {
  return '<div class="modal-row"><div class="modal-row-icon">' + icon + '</div>' +
    '<div style="flex:1"><div class="modal-row-label">' + esc(label) + '</div><div class="modal-row-val">' + val + '</div></div></div>';
}
function deleteEventRecord() {
  if (!currentEventId) return;
  if (!confirm('ยืนยันลบรายการนี้?')) return;
  google.script.run
    .withSuccessHandler(function(res){ showToast(res.message, res.status==='success'?'success':'error'); if(res.status==='success'){ closeModal(); loadAll(); } })
    .withFailureHandler(function(e){ showToast(e.message,'error'); })
    .deleteRecord(currentEventId);
}
function onModalOverlayClick(e) { if (e.target === e.currentTarget) closeModal(); }
function closeModal() { $r.getElementById('evModal').classList.remove('open'); }

// ─────────────────────────────────────────────
// EXPORT / SETUP
// ─────────────────────────────────────────────
function exportCSV() {
  showToast("กำลังสร้างไฟล์...","info");
  google.script.run
    .withSuccessHandler(function(csv) {
      var blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "hr_report_" + new Date().toISOString().slice(0,10) + ".csv"; a.click();
      showToast("Export สำเร็จ","success");
    })
    .withFailureHandler(function(){ showToast("Export ไม่สำเร็จ","error"); })
    .exportReport();
}
function runSetup() {
  var btn = $r.getElementById('setupBtn'); btn.textContent = '⏳ กำลังตั้งค่า...'; btn.disabled = true;
  google.script.run
    .withSuccessHandler(function(r){ showToast("ตั้งค่าระบบสำเร็จ","success"); btn.textContent = '✅ ตั้งค่าแล้ว'; setTimeout(function(){ btn.textContent = '⚙️ ตั้งค่าระบบ'; btn.disabled = false; }, 3000); })
    .withFailureHandler(function(e){ showToast("ตั้งค่าไม่สำเร็จ: "+(e.message||e),"error"); btn.textContent = '⚙️ ตั้งค่าระบบ'; btn.disabled = false; })
    .firstTimeSetup();
}

// ─────────────────────────────────────────────
// TOAST / LOADING / UTILS
// ─────────────────────────────────────────────
function showToast(msg, type) {
  type = type || 'info';
  var icons = { success:'✅', error:'❌', info:'ℹ️', warn:'⚠️' };
  var stack = $r.getElementById('toastStack');
  var t = document.createElement('div'); t.className = 'toast ' + type;
  t.innerHTML = '<span class="toast-icon">' + (icons[type]||'ℹ️') + '</span>' +
    '<span class="toast-msg">' + esc(msg) + '</span>' +
    '<span class="toast-close" data-hr-click="this.parentElement.remove()">×</span>';
  stack.appendChild(t);
  setTimeout(function(){ if(t.parentElement) t.remove(); }, 6000);
}
function hideLoading() {
  var el = $r.getElementById('loadingScreen'); if (!el) return;
  el.remove();
}
function getColorForStaff(name) {
  var s = staffList.find(function(x){ return x.name===name; });
  return (s && s.color) ? s.color : getAutoColor(name);
}
function getAutoColor(name) {
  var idx = 0;
  for (var i = 0; i < name.length; i++) idx += name.charCodeAt(i);
  return PALETTE[idx % PALETTE.length];
}
/** วว/ดด/ปปปป (พ.ศ.) — the one date format of the whole site */
function hrDmy(d) { return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + (d.getFullYear() + 543); }
function thaiDate(dateStr) {
  if (!dateStr) return '';
  try {
    var d = new Date(dateStr);
    return hrDmy(d);
  } catch(e){ return dateStr; }
}
function timeAgo(ms) {
  if (!ms) return '';
  var diff = Date.now() - ms;
  if (diff < 0) diff = 0;
  var min = Math.floor(diff / 60000);
  if (min < 1)  return 'เมื่อสักครู่';
  if (min < 60) return min + ' นาทีที่แล้ว';
  var hr = Math.floor(min / 60);
  if (hr < 24)  return hr + ' ชม.ที่แล้ว';
  var day = Math.floor(hr / 24);
  if (day < 7)  return day + ' วันที่แล้ว';
  return thaiDate(new Date(ms).toISOString().slice(0,10));
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escAttr(s) {
  return esc(String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,' '));
}


/* ---- sandtools glue (added by the port) ---- */
function removeParent(el) { if (el && el.parentElement) el.parentElement.remove(); }
function onOverlay(ev, el, fnName) { if (ev && ev.target === el && __H[fnName]) __H[fnName](); }
function setProgressLabel(v) { var el = $r.getElementById('projProgressVal'); if (el) el.textContent = v + '%'; }
function hrFp(cfg) { var o = {}; for (var k in cfg) o[k] = cfg[k]; o.appendTo = $r.getElementById('hrFpHost') || undefined; o.locale = (typeof flatpickr !== 'undefined' && flatpickr.l10ns && flatpickr.l10ns.th) || undefined; return o; }
function hrSafeColor(c) { c = String(c == null ? '' : c).trim(); return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#c4623d'; }
function hrSafeUrl(u) { u = String(u == null ? '' : u).trim(); return /^https?:\/\//i.test(u) ? u : '#'; }
function hrOpenUrl(u) { if (/^https?:\/\//i.test(String(u || ''))) window.open(u, '_blank', 'noopener,noreferrer'); }
function printPage() { env.print($r.querySelector('.panel.active'), $r.getElementById('panelTitle') && $r.getElementById('panelTitle').textContent); }

__H = { addStaff, bindProjectCombo, buildProvinceList, buildSwatches, changeStaffColor, changeStaffDept, changeView, checkQuota, closeAllCombos, closeAllMenus, closeDlogAddForm, closeEditModal, closeHistModal, closeHolAddForm, closeModal, closeProjAddForm, confirmDeleteDlog, confirmDeleteHoliday, confirmDeleteProj, confirmRestoreDefaults, copyDlogSummary, copyProjSummary, copyToClipboard, dayCell, deleteEventRecord, deleteStaff, downloadCSV, ensureEditFlatpickr, esc, escAttr, exportCSV, exportDlogCSV, exportProjCSV, filterDlogTable, filterReportTable, getAutoColor, getColorForStaff, getEffectiveType, getFilteredEvents, getHolidayEvents, getHolidayLabelEvents, getProjectStatus, goToDate, goToToday, hideLoading, hrInit, loadAll, loadDlogPanel, loadHolidayPanel, loadHolidays, loadProjPanel, loadReport, loadStaff, mRow, onDateChange, onDeptChange, onEditFileSelect, onEditTypeChange, onFileSelect, onModalOverlayClick, onNameInput, onOverlay, onTypeChange, openDlogEditForm, openEditModal, openHolEditForm, openProjEditForm, openRecentItem, openStaffHistory, printPage, removeParent, renderCalendar, renderDlogTable, renderHolidayTable, renderProjCurrentView, renderProjGrid, renderProjTimeline, renderRecentList, renderReportTable, renderStaffHistory, renderStaffTable, renderStreak, resetForm, restoreHoliday, runSetup, selectStaff, setDeptFilter, setHalfDay, setProgressLabel, showEventModal, showPanel, showToast, submitDlog, submitEdit, submitForm, submitHoliday, submitProject, syncHolidayMap, thaiDate, thaiDateFull, thaiDateShort, timeAgo, toggleDlogAddForm, toggleHolAddForm, toggleMenu, toggleProjAddForm, toggleProjView };
return { init: hrInit, handlers: __H, hydrate: hrHydrate };
}
