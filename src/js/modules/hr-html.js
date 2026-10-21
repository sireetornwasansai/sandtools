// Markup of the HR page (from the original Index.html; inline handlers replaced by data-hr-* attributes). Rendered inside a Shadow DOM root by hr.js.
// @ts-nocheck
export const HR_HTML = `



<div class="loading-screen" id="loadingScreen">
  <div class="loading-logo">🗂️</div>
  <div class="loading-title">ระบบบันทึกการปฏิบัติงาน</div>
  <div class="loading-sub">กำลังโหลดข้อมูล...</div>
  <div class="loading-bar"><div class="loading-bar-fill"></div></div>
</div>

<div class="layout">

  <aside class="sidebar">
    <div class="sidebar-brand">
      <div class="brand-row">
        <div class="brand-emblem">🏛️</div>
        <div>
          <div class="brand-name">ระบบปฏิบัติงาน</div>
          <div class="brand-sub">HR Control System</div>
        </div>
      </div>
    </div>

    <div class="sidebar-stats">
      <div class="sstat"><div class="sstat-num" id="stLa">—</div><div class="sstat-label">ลา (วันนี้)</div></div>
      <div class="sstat"><div class="sstat-num" id="stPrachum">—</div><div class="sstat-label">ประชุม (วันนี้)</div></div>
      <div class="sstat"><div class="sstat-num" id="stRat">—</div><div class="sstat-label">ราชการ</div></div>
      <div class="sstat"><div class="sstat-num" id="stOb">—</div><div class="sstat-label">อบรม</div></div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-section-label">เมนูหลัก</div>
      <button class="nav-item active" id="nav-calendar" data-hr-click="showPanel('calendar')">
        <span class="ni-icon">📅</span> ปฏิทิน
      </button>
      <button class="nav-item" id="nav-form" data-hr-click="showPanel('form')">
        <span class="ni-icon">✏️</span> บันทึกรายการ
      </button>
      <button class="nav-item" id="nav-report" data-hr-click="showPanel('report')">
        <span class="ni-icon">📊</span> รายงาน
      </button>
      <button class="nav-item" id="nav-staff" data-hr-click="showPanel('staff')">
        <span class="ni-icon">👥</span> จัดการพนักงาน
      </button>
      <button class="nav-item" id="nav-holidays" data-hr-click="showPanel('holidays')">
        <span class="ni-icon">🔴</span> จัดการวันหยุด
      </button>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-section-label">เครื่องมือส่วนตัว (Dev)</div>
      <button class="nav-item" id="nav-dailylog" data-hr-click="showPanel('dailylog')">
        <span class="ni-icon">📝</span> บันทึกประจำวัน
      </button>
      <button class="nav-item" id="nav-projects" data-hr-click="showPanel('projects')">
        <span class="ni-icon">🗂️</span> โปรเจคที่ดูแล
      </button>
    </div>

    <div class="dept-filter">
      <div class="dept-filter-label">แสดงกลุ่มงาน</div>
      <div class="dept-btns">
        <button class="dept-btn all-btn active" id="deptAll" data-hr-click="setDeptFilter('all')">
          <span class="dept-dot" style="background:var(--text3)"></span>ทั้งหมด
        </button>
        <button class="dept-btn" id="deptBtn0" data-hr-click="setDeptFilter(0)">
          <span class="dept-dot" style="background:var(--dept1)"></span>พัฒนาคุณภาพฯ
        </button>
        <button class="dept-btn" id="deptBtn1" data-hr-click="setDeptFilter(1)">
          <span class="dept-dot" style="background:var(--dept2)"></span>ยุทธศาสตร์ฯ
        </button>
        <button class="dept-btn" id="deptBtn2" data-hr-click="setDeptFilter(2)">
          <span class="dept-dot" style="background:var(--dept3)"></span>โสตฯ
        </button>
        <button class="dept-btn" id="deptBtn3" data-hr-click="setDeptFilter(3)">
          <span class="dept-dot" style="background:var(--amber)"></span>รวมทุกกลุ่มงาน
        </button>
      </div>
    </div>

    <div class="sidebar-datejump">
      <label>ไปยังวันที่</label>
      <div style="display:flex;gap:5px">
        <input type="date" id="dateJump" data-hr-change="goToDate(this.value)" style="flex:1">
        <button data-hr-click="goToToday()" title="วันนี้" style="flex-shrink:0;padding:6px 8px;background:var(--white);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);cursor:pointer;font-size:11px;white-space:nowrap">วันนี้</button>
      </div>
    </div>

    <div class="sidebar-setup">
      <button class="btn-setup" id="setupBtn" data-hr-click="runSetup()">
        <span>⚙️</span> ตั้งค่าระบบ
      </button>
    </div>
  </aside>

  <main class="main">
    <div class="topbar">
      <div class="topbar-left">
        <div class="topbar-title" id="panelTitle">📅 ปฏิทินการปฏิบัติงาน</div>
      </div>
      <div class="topbar-right">
        <div class="view-pill" id="calViewPill">
          <button class="view-pill-btn active" id="vMonth" data-hr-click="changeView('dayGridMonth')">เดือน</button>
          <button class="view-pill-btn" id="vWeek"  data-hr-click="changeView('timeGridWeek')">สัปดาห์</button>
          <button class="view-pill-btn" id="vDay"   data-hr-click="changeView('timeGridDay')">วัน</button>
          <button class="view-pill-btn" id="vList"  data-hr-click="changeView('listWeek')">รายการ</button>
        </div>
        <button class="btn-topbar primary" data-hr-click="showPanel('form')">+ บันทึก</button>
        <button class="btn-topbar" data-hr-click="loadAll()" title="รีเฟรชข้อมูล" aria-label="รีเฟรชข้อมูล">🔄</button>
        <button class="btn-topbar" data-hr-click="exportCSV()">⬇ Export</button>
      </div>
    </div>

    <div class="content-area">

      <!-- CALENDAR -->
      <div class="panel active" id="calendarPanel">
        <div id="calendar"></div>
        <p class="cal-tip">💡 แตะวันที่ในปฏิทินเพื่อเริ่มบันทึกรายการของวันนั้น · แตะรายการเพื่อดูรายละเอียดและไฟล์แนบ</p>
      </div>

      <!-- FORM -->
      <div class="panel" id="formPanel">
        <div class="card">
          <div class="card-header">
            <div class="card-header-icon">✏️</div>
            <div class="card-header-title">บันทึกรายการ</div>
          </div>
          <div class="card-body">

            <div class="form-group">
              <label class="form-label">ชื่อ-นามสกุล <span class="req">*</span></label>
              <div class="ac-wrap">
                <input class="form-input" id="fName" placeholder="พิมพ์เพื่อค้นหาชื่อ" autocomplete="off">
                <div class="ac-dropdown" id="acDrop"></div>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label">กลุ่มงาน <span class="req">*</span></label>
                <div class="select-wrap">
                  <select class="form-select" id="fDept" data-hr-change="onDeptChange()">
                    <option value="">— เลือกกลุ่มงาน —</option>
                    <option value="กลุ่มงานพัฒนาคุณภาพฯ">กลุ่มงานพัฒนาคุณภาพฯ</option>
                    <option value="กลุ่มงานยุทธศาสตร์ฯ">กลุ่มงานยุทธศาสตร์ฯ</option>
                    <option value="กลุ่มงานโสตฯ">กลุ่มงานโสตฯ</option>
                    <option value="รวมทุกกลุ่มงาน">รวมทุกกลุ่มงาน</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">ประเภท <span class="req">*</span></label>
                <div class="select-wrap">
                  <select class="form-select" id="fType" data-hr-change="onTypeChange()">
                    <option value="">— เลือกประเภท —</option>
                    <optgroup label="— การลาเต็มวัน —">
                      <option value="ลากิจ">ลากิจ</option>
                      <option value="ลาป่วย">ลาป่วย</option>
                      <option value="ลาพักผ่อน">ลาพักผ่อน</option>
                      <option value="ลาไปเรียน">ลาไปเรียน</option>
                    </optgroup>
                    <optgroup label="— การลาครึ่งวัน —">
                      <option value="ลากิจครึ่งวัน">ลากิจครึ่งวัน</option>
                      <option value="ลาป่วยครึ่งวัน">ลาป่วยครึ่งวัน</option>
                      <option value="ลาพักผ่อนครึ่งวัน">ลาพักผ่อนครึ่งวัน</option>
                    </optgroup>
                    <optgroup label="— ปฏิบัติงานนอกพื้นที่ —">
                      <option value="ไปราชการ">ไปราชการ</option>
                      <option value="อบรม">อบรม</option>
                      <option value="ประชุม">ประชุม</option>
                    </optgroup>
                    <optgroup label="— ประชุมคณะกรรมการ —">
                      <option value="ประชุม P4P">ประชุม P4P</option>
                      <option value="ประชุม กกบ.">ประชุม กกบ.</option>
                      <option value="ประชุม HR">ประชุม HR</option>
                      <option value="ประชุมภาพลักษณ์">ประชุมภาพลักษณ์</option>
                      <option value="ประชุม IRB">ประชุม IRB (จริยธรรมการวิจัย)</option>
                      <option value="ประชุม SMC">ประชุม SMC</option>
                      <option value="ประชุมอื่นๆ">ประชุมอื่นๆ (โปรดระบุในหมายเหตุ)</option>
                    </optgroup>
                    <optgroup label="— กิจกรรม —">
                      <option value="งานภายใน/ภายนอก">งานภายใน/ภายนอก</option>
                      <option value="Event พิเศษ">Event พิเศษ</option>
                    </optgroup>
                  </select>
                </div>
              </div>
            </div>

            <div class="halfday-group" id="halfDayGroup">
              <span class="halfday-label">ช่วงการลา</span>
              <div class="halfday-tabs">
                <button type="button" class="halfday-tab active" id="hdFull" data-hr-click="setHalfDay('full')">
                  <span class="tab-icon">📅</span>เต็มวัน<span class="tab-time">08:00 – 16:00</span>
                </button>
                <button type="button" class="halfday-tab" id="hdMorn" data-hr-click="setHalfDay('morning')">
                  <span class="tab-icon">🌅</span>ครึ่งเช้า<span class="tab-time">08:00 – 12:00</span>
                </button>
                <button type="button" class="halfday-tab" id="hdAftn" data-hr-click="setHalfDay('afternoon')">
                  <span class="tab-icon">🌇</span>ครึ่งบ่าย<span class="tab-time">13:00 – 16:00</span>
                </button>
              </div>
            </div>

            <div class="form-row" id="dateRangeGroup">
              <div class="form-group">
                <label class="form-label">วันที่เริ่ม <span class="req">*</span></label>
                <input class="form-input" type="date" id="fDate" data-hr-change="onDateChange()">
              </div>
              <div class="form-group">
                <label class="form-label" id="endDateLabel">วันที่สิ้นสุด</label>
                <input class="form-input" type="date" id="fEndDate">
              </div>
            </div>

            <div class="form-group" id="timeGroup">
              <label class="form-label">ช่วงเวลา (ระบุเวลาเสมอ) <span class="req">*</span></label>
              <div class="time-row">
                <div><input class="form-input" type="text" id="fStart" placeholder="เวลาเริ่ม (เช่น 08:30)"></div>
                <div class="time-sep">ถึง</div>
                <div><input class="form-input" type="text" id="fEnd" placeholder="เวลาสิ้นสุด (เช่น 16:30)"></div>
              </div>
            </div>

            <div class="form-row" id="outOfAreaGroup" style="display:none">
              <div class="form-group">
                <label class="form-label">📍 จังหวัด</label>
                <input class="form-input" id="fProvince" list="provinceDatalist" placeholder="พิมพ์หรือเลือกจังหวัด" autocomplete="off">
              </div>
              <div class="form-group">
                <label class="form-label">🎯 ภารกิจ</label>
                <input class="form-input" id="fMission" placeholder="เช่น ประชุมชี้แจงนโยบาย ณ ศาลากลางจังหวัด">
              </div>
            </div>
            <datalist id="provinceDatalist"></datalist>

            <div class="notice warn" id="holidayNotice" style="display:none">
              <span class="notice-icon">🔴</span>
              <span id="holidayMsg">วันหยุดราชการ</span>
            </div>
            <div class="notice danger" id="holidayBlockNotice" style="display:none">
              <span class="notice-icon">🚫</span>
              <span id="holidayBlockMsg">ไม่สามารถลาในวันหยุดราชการได้</span>
            </div>
            <div class="notice warn" id="quotaNotice">
              <span class="notice-icon">⚠️</span>
              <span id="quotaMsg">กรุณาระบุเหตุผลในหมายเหตุ</span>
            </div>
            <div class="notice danger" id="overlapNotice" style="display:none">
              <span class="notice-icon">🔔</span>
              <span id="overlapMsg">ตรวจพบเวลาทับซ้อน</span>
            </div>

            <div class="form-group">
              <label class="form-label">หมายเหตุ</label>
              <input class="form-input" id="fNote" placeholder="ระบุรายละเอียดหรือเหตุผล">
            </div>

            <div class="form-group">
              <label class="form-label">แนบไฟล์ (ถ้ามี)</label>
              <div class="file-upload" id="fileArea">
                <input type="file" id="fFile" accept="application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.heic,.heif" multiple data-hr-change="onFileSelect(this)" aria-label="แนบไฟล์">
                <div class="file-upload-icon">📎</div>
                <div class="file-upload-hint">แตะเพื่อเลือกไฟล์หรือถ่ายรูป · PDF / รูปภาพ · สูงสุด 3 ไฟล์ (รูปจะถูกย่อให้อัตโนมัติ)</div>
                <div class="file-upload-name" id="fFileName"></div>
              </div>
              <div class="file-list" id="fFileList"></div>
              <div class="upload-status" id="fUploadStatus" role="status" aria-live="polite"></div>
            </div>

            <button class="btn-submit" id="submitBtn" data-hr-click="submitForm()">
              <span class="btn-text">💾 บันทึกรายการ</span>
            </button>
          </div>
        </div>

        <div class="card" style="margin-top:16px;">
          <div class="card-header">
            <div class="card-header-icon">🕒</div>
            <div class="card-header-title">รายการล่าสุด</div>
            <button class="btn-refresh-recent" data-hr-click="loadAll()" title="รีเฟรช" style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:15px;opacity:0.6;">🔄</button>
          </div>
          <div class="card-body">
            <div id="recentList"><div class="recent-empty">กำลังโหลด...</div></div>
          </div>
        </div>
      </div>

      <!-- STAFF -->
      <div class="panel" id="staffPanel">
        <div class="card">
          <div class="card-header">
            <div class="card-header-icon">➕</div>
            <div class="card-header-title">เพิ่มเจ้าหน้าที่</div>
          </div>
          <div class="card-body">
            <div class="staff-add-row">
              <div class="form-group">
                <label class="form-label">ชื่อ-นามสกุล</label>
                <input class="form-input" id="sName" placeholder="ชื่อ-นามสกุล">
              </div>
              <div class="form-group">
                <label class="form-label">กลุ่มงาน</label>
                <div class="select-wrap">
                  <select class="form-select" id="sDept">
                    <option value="กลุ่มงานพัฒนาคุณภาพฯ">กลุ่มงานพัฒนาคุณภาพฯ</option>
                    <option value="กลุ่มงานยุทธศาสตร์ฯ">กลุ่มงานยุทธศาสตร์ฯ</option>
                    <option value="กลุ่มงานโสตฯ">กลุ่มงานโสตฯ</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">สีประจำตัว</label>
                <div id="colorSwatches" class="color-swatches"></div>
                <input type="hidden" id="sColor" value="#c4623d">
              </div>
              <button class="btn-add" data-hr-click="addStaff()">+ เพิ่ม</button>
            </div>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ชื่อ-นามสกุล</th><th>กลุ่มงาน</th>
                <th style="text-align:center">สี</th>
                <th style="text-align:center;width:80px">จัดการ</th>
              </tr>
            </thead>
            <tbody id="staffBody">
              <tr><td colspan="4" class="empty-state">กำลังโหลด...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- REPORT -->
      <div class="panel" id="reportPanel">
        <div class="card">
          <div class="card-body" style="padding:14px 20px">
            <div class="report-controls">
              <div class="form-group" style="min-width:100px">
                <label class="form-label">ปี (พ.ศ.)</label>
                <input class="form-input" type="number" id="rYear" placeholder="2568" style="width:110px">
              </div>
              <div class="form-group" style="min-width:140px">
                <label class="form-label">เดือน</label>
                <div class="select-wrap">
                  <select class="form-select" id="rMonth" style="width:160px">
                    <option value="1">มกราคม</option><option value="2">กุมภาพันธ์</option>
                    <option value="3">มีนาคม</option><option value="4">เมษายน</option>
                    <option value="5">พฤษภาคม</option><option value="6">มิถุนายน</option>
                    <option value="7">กรกฎาคม</option><option value="8">สิงหาคม</option>
                    <option value="9">กันยายน</option><option value="10">ตุลาคม</option>
                    <option value="11">พฤศจิกายน</option><option value="12">ธันวาคม</option>
                  </select>
                </div>
              </div>
              <div class="form-group" style="min-width:160px">
                <label class="form-label">กลุ่มงาน</label>
                <div class="select-wrap">
                  <select class="form-select" id="rDept" style="width:180px">
                    <option value="">— ทั้งหมด —</option>
                    <option value="กลุ่มงานพัฒนาคุณภาพฯ">กลุ่มงานพัฒนาคุณภาพฯ</option>
                    <option value="กลุ่มงานยุทธศาสตร์ฯ">กลุ่มงานยุทธศาสตร์ฯ</option>
                    <option value="กลุ่มงานโสตฯ">กลุ่มงานโสตฯ</option>
                    <option value="รวมทุกกลุ่มงาน">รวมทุกกลุ่มงาน</option>
                  </select>
                </div>
              </div>
              <div class="form-group" style="min-width:140px">
                <label class="form-label">ค้นหาชื่อ</label>
                <input class="form-input" type="text" id="rSearch" placeholder="ค้นหาชื่อ..." style="width:150px" data-hr-input="filterReportTable()">
              </div>
              <button class="btn-search" data-hr-click="loadReport()">🔍 ค้นหา</button>
              <button class="btn-topbar" data-hr-click="exportCSV()" style="align-self:flex-end;height:38px">⬇ Export CSV</button>
            </div>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ชื่อ</th><th>กลุ่มงาน</th>
                <th style="text-align:center">ลากิจ<br><span style="font-size:10px;font-weight:400;opacity:.7">(วัน)</span></th>
                <th style="text-align:center">ลาป่วย<br><span style="font-size:10px;font-weight:400;opacity:.7">(วัน)</span></th>
                <th style="text-align:center">ลาพักผ่อน<br><span style="font-size:10px;font-weight:400;opacity:.7">(วัน)</span></th>
                <th style="text-align:center">ลาไปเรียน<br><span style="font-size:10px;font-weight:400;opacity:.7">(วัน)</span></th>
                <th style="text-align:center">ราชการ<br><span style="font-size:10px;font-weight:400;opacity:.7">(วัน)</span></th>
                <th style="text-align:center">อบรม<br><span style="font-size:10px;font-weight:400;opacity:.7">(วัน)</span></th>
                <th style="text-align:center">ประชุม<br><span style="font-size:10px;font-weight:400;opacity:.7">(วัน)</span></th>
                <th style="text-align:center">P4P</th><th style="text-align:center">กกบ.</th><th style="text-align:center">HR</th>
                <th style="text-align:center">ภาพลักษณ์</th><th style="text-align:center">IRB</th>
                <th style="text-align:center">SMC</th><th style="text-align:center">ปชุมอื่นๆ</th>
                <th style="text-align:center">งานภายใน/ภายนอก</th>
                <th style="text-align:center">Event พิเศษ</th>
              </tr>
            </thead>
            <tbody id="reportBody">
              <tr><td colspan="18" class="empty-state">เลือกเดือนแล้วกดค้นหา</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ═══ HOLIDAYS PANEL (ใหม่) ═══ -->
      <div class="panel" id="holidaysPanel">

        <!-- Toolbar -->
        <div class="hol-toolbar">
          <div class="hol-toolbar-left">
            <button class="btn-topbar primary" data-hr-click="toggleHolAddForm()">
              ➕ เพิ่มวันหยุด
            </button>
            <button class="btn-topbar" data-hr-click="confirmRestoreDefaults()" style="color:var(--warn);border-color:rgba(207,151,73,0.45)">
              🔄 คืนค่าเริ่มต้น
            </button>
          </div>
          <div style="font-size:12px;color:var(--text3)">
            แสดงวันหยุดราชการ ปี 2568–2569
          </div>
        </div>

        <!-- Add/Edit Form -->
        <div class="hol-add-form" id="holAddForm">
          <div class="hol-add-form-title">
            <span id="holFormIcon">➕</span>
            <span id="holFormTitle">เพิ่มวันหยุดราชการ</span>
          </div>
          <div class="hol-add-row">
            <div class="form-group" style="min-width:160px">
              <label class="form-label">วันที่ <span class="req">*</span></label>
              <input class="form-input" type="date" id="holDate">
            </div>
            <div class="form-group" style="flex:2;min-width:200px">
              <label class="form-label">ชื่อวันหยุด <span class="req">*</span></label>
              <input class="form-input" type="text" id="holName" placeholder="เช่น วันพืชมงคล">
            </div>
            <button class="btn-hol-save" data-hr-click="submitHoliday()">💾 บันทึก</button>
            <button class="btn-hol-cancel" data-hr-click="closeHolAddForm()">ยกเลิก</button>
          </div>
        </div>

        <!-- Table -->
        <div id="holTableWrap">
          <div class="empty-state" style="padding:40px">กำลังโหลด...</div>
        </div>

        <div class="hol-note">
          🔴 สีแดง = วันหยุดปกติ &nbsp;|&nbsp;
          🟢 สีเขียว = วันหยุดที่เพิ่มเอง &nbsp;|&nbsp;
          ขีดทับ = วันหยุดที่ถูกซ่อน &nbsp;|&nbsp;
          ข้อมูลอ้างอิงตามมติ ครม. รวมวันหยุดกรณีพิเศษ
        </div>
      </div>

      <!-- ═══ DAILY LOG PANEL (ใหม่) — บันทึกประจำวัน ═══ -->
      <div class="panel" id="dailylogPanel">

        <!-- Toolbar -->
        <div class="hol-toolbar">
          <div class="hol-toolbar-left">
            <button class="btn-topbar primary" data-hr-click="toggleDlogAddForm()">
              ➕ บันทึกวันนี้
            </button>
          </div>
          <div class="menu-wrap">
            <button class="btn-topbar" data-hr-click="toggleMenu('dlogExportMenu')">⬇ Export</button>
            <div class="menu-dropdown" id="dlogExportMenu">
              <div class="menu-item" data-hr-click="exportDlogCSV(); closeAllMenus()">📄 Export CSV</div>
              <div class="menu-item" data-hr-click="copyDlogSummary(); closeAllMenus()">📋 คัดลอกสรุปข้อความ</div>
              <div class="menu-item" data-hr-click="printPage(); closeAllMenus()">🖨️ พิมพ์</div>
            </div>
          </div>
        </div>

        <!-- Add/Edit Form -->
        <div class="hol-add-form" id="dlogAddForm">
          <div class="hol-add-form-title">
            <span id="dlogFormIcon">➕</span>
            <span id="dlogFormTitle">บันทึกประจำวัน</span>
          </div>
          <input type="hidden" id="dlogId">
          <div class="hol-add-row">
            <div class="form-group" style="min-width:150px;flex:0 0 150px">
              <label class="form-label">วันที่ <span class="req">*</span></label>
              <input class="form-input" type="date" id="dlogDate">
            </div>
            <div class="form-group combo-wrap" style="min-width:200px;flex:1 1 200px">
              <label class="form-label">โปรเจค</label>
              <input class="form-input" type="text" id="dlogProject" placeholder="พิมพ์เพื่อค้นหา หรือเว้นว่างไว้ (ทั่วไป)" autocomplete="off">
              <div class="combo-dropdown" id="dlogProjectDrop"></div>
            </div>
            <div class="form-group" style="min-width:100px;flex:0 0 100px">
              <label class="form-label">ชั่วโมง</label>
              <input class="form-input" type="number" step="0.5" min="0" id="dlogHours" placeholder="เช่น 2">
            </div>
          </div>
          <div class="form-group" style="margin-top:10px">
            <label class="form-label">รายละเอียดงานที่ทำ <span class="req">*</span></label>
            <textarea class="form-input" id="dlogDetail" rows="3" placeholder="วันนี้ทำอะไรบ้าง..." style="resize:vertical"></textarea>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn-hol-save" data-hr-click="submitDlog()">💾 บันทึก</button>
            <button class="btn-hol-cancel" data-hr-click="closeDlogAddForm()">ยกเลิก</button>
          </div>
        </div>

        <!-- Streak strip: 14 วันล่าสุด -->
        <div class="dlog-streak" id="dlogStreak">
          <span class="dlog-streak-label">14 วันล่าสุด:</span>
        </div>

        <!-- Filters -->
        <div class="dlog-filters">
          <div class="form-group combo-wrap" style="min-width:200px">
            <label class="form-label">กรองตามโปรเจค</label>
            <input class="form-input" type="text" id="dlogFilterProject" placeholder="พิมพ์เพื่อค้นหา หรือเว้นว่าง = ทั้งหมด" autocomplete="off" data-hr-input="filterDlogTable()">
            <div class="combo-dropdown" id="dlogFilterProjectDrop"></div>
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">ค้นหา</label>
            <input class="form-input" type="text" id="dlogSearch" placeholder="ค้นหาในรายละเอียด..." data-hr-input="filterDlogTable()">
          </div>
        </div>

        <!-- List -->
        <div id="dlogListWrap">
          <div class="empty-state" style="padding:40px">กำลังโหลด...</div>
        </div>
      </div>

      <!-- ═══ PROJECTS PANEL (ใหม่) — โปรเจคที่ดูแล ═══ -->
      <div class="panel" id="projectsPanel">

        <!-- Toolbar -->
        <div class="hol-toolbar">
          <div class="hol-toolbar-left">
            <button class="btn-topbar primary" data-hr-click="toggleProjAddForm()">
              ➕ เพิ่มโปรเจค
            </button>
            <button class="btn-topbar" id="projViewToggleBtn" data-hr-click="toggleProjView()">📊 มุมมอง Timeline</button>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="font-size:12px;color:var(--text3)">
              ติดตามสถานะและงานที่ต้องทำต่อของแต่ละเว็บไซต์
            </div>
            <div class="menu-wrap">
              <button class="btn-topbar" data-hr-click="toggleMenu('projExportMenu')">⬇ Export</button>
              <div class="menu-dropdown" id="projExportMenu">
                <div class="menu-item" data-hr-click="exportProjCSV(); closeAllMenus()">📄 Export CSV</div>
                <div class="menu-item" data-hr-click="copyProjSummary(); closeAllMenus()">📋 คัดลอกสรุปข้อความ</div>
                <div class="menu-item" data-hr-click="printPage(); closeAllMenus()">🖨️ พิมพ์</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Add/Edit Form -->
        <div class="hol-add-form" id="projAddForm">
          <div class="hol-add-form-title">
            <span id="projFormIcon">➕</span>
            <span id="projFormTitle">เพิ่มโปรเจค</span>
          </div>
          <input type="hidden" id="projId">
          <div class="hol-add-row">
            <div class="form-group" style="flex:1;min-width:180px">
              <label class="form-label">ชื่อโปรเจค <span class="req">*</span></label>
              <input class="form-input" type="text" id="projName" placeholder="เช่น เว็บโรงพยาบาล ก.">
            </div>
            <div class="form-group" style="flex:1;min-width:180px">
              <label class="form-label">URL เว็บไซต์</label>
              <input class="form-input" type="text" id="projUrl" placeholder="https://...">
            </div>
            <div class="form-group" style="min-width:160px;flex:0 0 170px">
              <label class="form-label">สถานะ</label>
              <div class="select-wrap">
                <select class="form-select" id="projStatus"></select>
              </div>
            </div>
          </div>
          <div class="hol-add-row" style="margin-top:10px">
            <div class="form-group" style="min-width:150px;flex:0 0 150px">
              <label class="form-label">เริ่มโปรเจค</label>
              <input class="form-input" type="date" id="projStartDate">
            </div>
            <div class="form-group" style="min-width:150px;flex:0 0 150px">
              <label class="form-label">กำหนดเสร็จ</label>
              <input class="form-input" type="date" id="projTargetDate">
            </div>
            <div class="form-group" style="min-width:160px;flex:1">
              <label class="form-label">ความคืบหน้า: <span id="projProgressVal">0%</span></label>
              <input type="range" min="0" max="100" step="5" id="projProgress" style="width:100%" data-hr-input="setProgressLabel(this.value)">
            </div>
          </div>
          <div class="form-group" style="margin-top:10px">
            <label class="form-label">ต้องทำต่อ (Next action)</label>
            <input class="form-input" type="text" id="projNextAction" placeholder="เช่น แก้บั๊กฟอร์มติดต่อ, รอลูกค้ายืนยันเนื้อหา">
          </div>
          <div class="form-group">
            <label class="form-label">หมายเหตุ</label>
            <textarea class="form-input" id="projNotes" rows="2" placeholder="ข้อมูลเพิ่มเติม เช่น โฮสต์, ผู้ติดต่อ" style="resize:vertical"></textarea>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn-hol-save" data-hr-click="submitProject()">💾 บันทึก</button>
            <button class="btn-hol-cancel" data-hr-click="closeProjAddForm()">ยกเลิก</button>
          </div>
        </div>

        <!-- Grid / Timeline -->
        <div id="projGridWrap">
          <div class="empty-state" style="padding:40px">กำลังโหลด...</div>
        </div>
        <div id="projTimelineWrap" style="display:none"></div>
      </div>

    </div><!-- /content-area -->
  </main>
</div>

<!-- EVENT MODAL -->
<div class="modal-overlay" id="evModal" role="dialog" aria-modal="true" aria-labelledby="evModalTitle" data-hr-click="onModalOverlayClick(event)">
  <div class="modal">
    <div class="modal-head">
      <div class="modal-title" id="evModalTitle">รายละเอียด</div>
      <button class="modal-close" data-hr-click="closeModal()" aria-label="ปิด">×</button>
    </div>
    <div class="modal-body" id="evModalBody"></div>
    <div class="modal-foot" id="evModalFoot"></div>
  </div>
</div>

<!-- EDIT RECORD MODAL -->
<div class="modal-overlay" id="editModal" role="dialog" aria-modal="true" data-hr-click="onOverlay(event,this,'closeEditModal')">
  <div class="modal" style="width:500px">
    <div class="modal-head">
      <div class="modal-title">✏️ แก้ไขรายการ</div>
      <button class="modal-close" data-hr-click="closeEditModal()" aria-label="ปิด">×</button>
    </div>
    <div class="modal-body" style="padding:16px 20px">
      <input type="hidden" id="editId">
      <input type="hidden" id="editFileUrl">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">ชื่อ-นามสกุล <span class="req">*</span></label>
          <input class="form-input" id="editName" readonly style="background:var(--bg)">
        </div>
        <div class="form-group">
          <label class="form-label">กลุ่มงาน <span class="req">*</span></label>
          <div class="select-wrap">
            <select class="form-select" id="editDept">
              <option value="กลุ่มงานพัฒนาคุณภาพฯ">กลุ่มงานพัฒนาคุณภาพฯ</option>
              <option value="กลุ่มงานยุทธศาสตร์ฯ">กลุ่มงานยุทธศาสตร์ฯ</option>
              <option value="กลุ่มงานโสตฯ">กลุ่มงานโสตฯ</option>
            </select>
          </div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">ประเภท <span class="req">*</span></label>
          <div class="select-wrap">
            <select class="form-select" id="editType" data-hr-change="onEditTypeChange()">
              <optgroup label="— การลาเต็มวัน —">
                <option value="ลากิจ">ลากิจ</option>
                <option value="ลาป่วย">ลาป่วย</option>
                <option value="ลาพักผ่อน">ลาพักผ่อน</option>
                <option value="ลาไปเรียน">ลาไปเรียน</option>
              </optgroup>
              <optgroup label="— การลาครึ่งวัน —">
                <option value="ลากิจครึ่งวัน">ลากิจครึ่งวัน</option>
                <option value="ลาป่วยครึ่งวัน">ลาป่วยครึ่งวัน</option>
                <option value="ลาพักผ่อนครึ่งวัน">ลาพักผ่อนครึ่งวัน</option>
              </optgroup>
              <optgroup label="— ปฏิบัติงานนอกพื้นที่ —">
                <option value="ไปราชการ">ไปราชการ</option>
                <option value="อบรม">อบรม</option>
                <option value="ประชุม">ประชุม</option>
              </optgroup>
              <optgroup label="— ประชุมคณะกรรมการ —">
                <option value="ประชุม P4P">ประชุม P4P</option>
                <option value="ประชุม กกบ.">ประชุม กกบ.</option>
                <option value="ประชุม HR">ประชุม HR</option>
                <option value="ประชุมภาพลักษณ์">ประชุมภาพลักษณ์</option>
                <option value="ประชุม IRB">ประชุม IRB</option>
                <option value="ประชุม SMC">ประชุม SMC</option>
                <option value="ประชุมอื่นๆ">ประชุมอื่นๆ</option>
              </optgroup>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">วันที่เริ่ม <span class="req">*</span></label>
          <input class="form-input" type="date" id="editStartDate">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">วันที่สิ้นสุด</label>
          <input class="form-input" type="date" id="editEndDate">
        </div>
        <div class="form-group">
          <label class="form-label">เวลาเริ่ม – สิ้นสุด</label>
          <div style="display:flex;gap:6px;align-items:center">
            <input class="form-input" type="text" id="editStartTime" placeholder="08:00" style="flex:1">
            <span style="color:var(--text3);font-size:12px">–</span>
            <input class="form-input" type="text" id="editEndTime" placeholder="16:00" style="flex:1">
          </div>
        </div>
      </div>
      <div class="form-row" id="editOutOfAreaGroup" style="display:none">
        <div class="form-group">
          <label class="form-label">📍 จังหวัด</label>
          <input class="form-input" id="editProvince" list="provinceDatalist" placeholder="พิมพ์หรือเลือกจังหวัด" autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label">🎯 ภารกิจ</label>
          <input class="form-input" id="editMission" placeholder="เช่น ประชุมชี้แจงนโยบาย ณ ศาลากลางจังหวัด">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">หมายเหตุ</label>
        <input class="form-input" id="editNote">
      </div>
      <div class="form-group">
        <label class="form-label">ไฟล์แนบ</label>
        <div class="file-list" id="editFileList"></div>
        <div class="file-upload" id="editFileArea">
          <input type="file" id="editFile" accept="application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.heic,.heif" multiple data-hr-change="onEditFileSelect(this)" aria-label="แนบไฟล์เพิ่ม">
          <div class="file-upload-icon">📎</div>
          <div class="file-upload-hint">แตะเพื่อเพิ่มไฟล์ · PDF / รูปภาพ · รวมไม่เกิน 3 ไฟล์</div>
          <div class="file-upload-name" id="editFileName"></div>
        </div>
        <div class="upload-status" id="editUploadStatus" role="status" aria-live="polite"></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn-modal-edit" id="editSaveBtn" data-hr-click="submitEdit()" style="flex:1">💾 บันทึกการแก้ไข</button>
      <button class="btn-modal-del" data-hr-click="closeEditModal()">ยกเลิก</button>
    </div>
  </div>
</div>

<!-- STAFF HISTORY MODAL -->
<div class="modal-overlay" id="histModal" role="dialog" aria-modal="true" aria-labelledby="histModalTitle" data-hr-click="onOverlay(event,this,'closeHistModal')">
  <div class="modal" style="width:480px">
    <div class="modal-head">
      <div class="modal-title" id="histModalTitle">🕘 ประวัติการบันทึก</div>
      <button class="modal-close" data-hr-click="closeHistModal()" aria-label="ปิด">×</button>
    </div>
    <div class="modal-body" id="histModalBody" style="padding:16px 20px;max-height:60vh;overflow-y:auto"></div>
    <div class="modal-foot">
      <button class="btn-modal-del" data-hr-click="closeHistModal()" style="flex:1">ปิด</button>
    </div>
  </div>
</div>

<div class="toast-stack" id="toastStack"></div>

`;
