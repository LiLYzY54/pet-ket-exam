/**
 * PET / KET 在线模考 · Word (.docx) 导出引擎
 * 严格保持原排版、纯前端无依赖生成原生 Office Open XML (.docx) 格式报告
 * 客观题（听力、阅读）自动从测试数据填充；主观题（写作、口语）预留充足标准评分卡与评语空位供教师批改手填
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WordReportExporter = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  // --- CRC32 计算 ---
  function crc32(buf) {
    let table = crc32.table;
    if (!table) {
      table = crc32.table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c >>> 0;
      }
    }
    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    return (crc ^ (-1)) >>> 0;
  }

  // --- 纯前端轻量级 PKZip 打包器（Store 模式，兼容 Office 规范） ---
  class SimpleZip {
    constructor() {
      this.files = [];
      this.encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    }
    _toBytes(content) {
      if (typeof content === 'string') {
        if (this.encoder) return this.encoder.encode(content);
        if (typeof Buffer !== 'undefined') return Buffer.from(content, 'utf8');
        const arr = new Uint8Array(content.length * 3);
        let len = 0;
        for (let i = 0; i < content.length; i++) {
          let code = content.charCodeAt(i);
          if (code < 0x80) arr[len++] = code;
          else if (code < 0x800) {
            arr[len++] = 0xc0 | (code >> 6);
            arr[len++] = 0x80 | (code & 0x3f);
          } else {
            arr[len++] = 0xe0 | (code >> 12);
            arr[len++] = 0x80 | ((code >> 6) & 0x3f);
            arr[len++] = 0x80 | (code & 0x3f);
          }
        }
        return arr.subarray(0, len);
      }
      return content instanceof Uint8Array ? content : new Uint8Array(content);
    }
    file(name, content) {
      this.files.push({ name, data: this._toBytes(content) });
    }
    generate() {
      let totalSize = 0;
      const fileHeaders = [];
      const cdHeaders = [];

      for (const f of this.files) {
        const nameBytes = this._toBytes(f.name);
        const crc = crc32(f.data);
        const size = f.data.length;

        // Local header (30 bytes + name length)
        const lh = new Uint8Array(30 + nameBytes.length);
        const dvLh = new DataView(lh.buffer);
        dvLh.setUint32(0, 0x04034b50, true);
        dvLh.setUint16(4, 20, true);
        dvLh.setUint16(6, 0x0800, true); // UTF-8 flag
        dvLh.setUint16(8, 0, true);      // store mode
        dvLh.setUint16(10, 0, true);
        dvLh.setUint16(12, 0, true);
        dvLh.setUint32(14, crc, true);
        dvLh.setUint32(18, size, true);
        dvLh.setUint32(22, size, true);
        dvLh.setUint16(26, nameBytes.length, true);
        dvLh.setUint16(28, 0, true);
        lh.set(nameBytes, 30);

        fileHeaders.push({ lh, data: f.data, offset: totalSize });
        totalSize += lh.length + size;

        // Central Directory header (46 bytes + name length)
        const cdh = new Uint8Array(46 + nameBytes.length);
        const dvCd = new DataView(cdh.buffer);
        dvCd.setUint32(0, 0x02014b50, true);
        dvCd.setUint16(4, 20, true);
        dvCd.setUint16(6, 20, true);
        dvCd.setUint16(8, 0x0800, true);
        dvCd.setUint16(10, 0, true);
        dvCd.setUint16(12, 0, true);
        dvCd.setUint16(14, 0, true);
        dvCd.setUint32(16, crc, true);
        dvCd.setUint32(20, size, true);
        dvCd.setUint32(24, size, true);
        dvCd.setUint16(28, nameBytes.length, true);
        dvCd.setUint16(30, 0, true);
        dvCd.setUint16(32, 0, true);
        dvCd.setUint16(34, 0, true);
        dvCd.setUint16(36, 0, true);
        dvCd.setUint32(38, 0, true);
        dvCd.setUint32(42, fileHeaders[fileHeaders.length - 1].offset, true);
        cdh.set(nameBytes, 46);

        cdHeaders.push(cdh);
      }

      const cdOffset = totalSize;
      let cdSize = 0;
      for (const c of cdHeaders) cdSize += c.length;

      // End of central directory (22 bytes)
      const eocd = new Uint8Array(22);
      const dvEocd = new DataView(eocd.buffer);
      dvEocd.setUint32(0, 0x06054b50, true);
      dvEocd.setUint16(4, 0, true);
      dvEocd.setUint16(6, 0, true);
      dvEocd.setUint16(8, this.files.length, true);
      dvEocd.setUint16(10, this.files.length, true);
      dvEocd.setUint32(12, cdSize, true);
      dvEocd.setUint32(16, cdOffset, true);
      dvEocd.setUint16(20, 0, true);

      // 组装整个 ZIP 二进制流
      const full = new Uint8Array(totalSize + cdSize + 22);
      let cur = 0;
      for (const item of fileHeaders) {
        full.set(item.lh, cur); cur += item.lh.length;
        full.set(item.data, cur); cur += item.data.length;
      }
      for (const c of cdHeaders) {
        full.set(c, cur); cur += c.length;
      }
      full.set(eocd, cur);

      return full;
    }
  }

  // --- XML 转义工具 ---
  function escXml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // --- OpenXML 元素构造原语 ---
  function wRun(text, opt = {}) {
    const b = opt.bold ? '<w:b/><w:bCs/>' : '';
    const i = opt.italic ? '<w:i/><w:iCs/>' : '';
    const szVal = opt.size ?? 21; // half-points: 21 = 10.5pt, 28 = 14pt, 36 = 18pt
    const sz = `<w:sz w:val="${szVal}"/><w:szCs w:val="${szVal}"/>`;
    const color = `<w:color w:val="${opt.color || '1E293B'}"/>`;
    const font = opt.font || 'Microsoft YaHei';
    const rFonts = `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`;
    const rPr = `<w:rPr>${rFonts}${b}${i}${color}${sz}</w:rPr>`;
    return `<w:r>${rPr}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`;
  }

  function wP(runs, opt = {}) {
    const jc = opt.align ? `<w:jc w:val="${opt.align}"/>` : '';
    const before = opt.spaceBefore ?? 80;
    const after = opt.spaceAfter ?? 80;
    const line = opt.lineSpacing ?? 260;
    const spacing = `<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="auto"/>`;
    const bdrBottom = opt.borderBottom ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${opt.borderBottom}"/></w:pBdr>` : '';
    const pPr = `<w:pPr>${jc}${spacing}${bdrBottom}</w:pPr>`;

    let runXml = '';
    if (typeof runs === 'string') {
      runXml = wRun(runs, opt);
    } else if (Array.isArray(runs)) {
      runXml = runs.map(r => typeof r === 'string' ? wRun(r, opt) : wRun(r.text, { ...opt, ...r })).join('');
    } else if (runs && runs.text) {
      runXml = wRun(runs.text, { ...opt, ...runs });
    }
    return `<w:p>${pPr}${runXml}</w:p>`;
  }

  function wTable(rows, opt = {}) {
    const totalW = opt.width || 9600;
    const tblW = `<w:tblW w:w="${totalW}" w:type="dxa"/>`;
    const jc = `<w:jc w:val="${opt.align || 'center'}"/>`;
    const bdrColor = opt.borderColor || 'CBD5E1';
    const bdrVal = opt.noBorder ? 'none' : 'single';
    const tblBorders = `<w:tblBorders>
      <w:top w:val="${bdrVal}" w:sz="4" w:space="0" w:color="${bdrColor}"/>
      <w:left w:val="${bdrVal}" w:sz="4" w:space="0" w:color="${bdrColor}"/>
      <w:bottom w:val="${bdrVal}" w:sz="4" w:space="0" w:color="${bdrColor}"/>
      <w:right w:val="${bdrVal}" w:sz="4" w:space="0" w:color="${bdrColor}"/>
      <w:insideH w:val="${bdrVal}" w:sz="4" w:space="0" w:color="${bdrColor}"/>
      <w:insideV w:val="${bdrVal}" w:sz="4" w:space="0" w:color="${bdrColor}"/>
    </w:tblBorders>`;
    const tblCellMar = `<w:tblCellMar>
      <w:top w:w="${opt.paddingTop ?? 140}" w:type="dxa"/>
      <w:bottom w:w="${opt.paddingBottom ?? 140}" w:type="dxa"/>
      <w:left w:w="${opt.paddingLeft ?? 180}" w:type="dxa"/>
      <w:right w:w="${opt.paddingRight ?? 180}" w:type="dxa"/>
    </w:tblCellMar>`;
    const tblPr = `<w:tblPr>${tblW}${jc}${tblBorders}${tblCellMar}</w:tblPr>`;

    const colWidths = opt.widths || [];

    // 计算并生成 <w:tblGrid>（OpenXML 规范要求紧跟 w:tblPr）
    let gridCols = '';
    if (colWidths && colWidths.length > 0) {
      gridCols = colWidths.map(w => `<w:gridCol w:w="${w}"/>`).join('');
    } else if (rows.length > 0) {
      let maxRow = rows[0];
      for (const r of rows) {
        if (r.length > maxRow.length) maxRow = r;
      }
      const colCount = maxRow.length || 1;
      maxRow.forEach((c) => {
        const cw = (typeof c === 'object' && c !== null && c.width) ? c.width : Math.floor(totalW / colCount);
        gridCols += `<w:gridCol w:w="${cw}"/>`;
      });
    }
    const tblGrid = `<w:tblGrid>${gridCols}</w:tblGrid>`;

    let trXml = '';
    rows.forEach((row, rIdx) => {
      let tcXml = '';
      const isHeader = rIdx === 0 && opt.headerBg;

      row.forEach((cell, cIdx) => {
        const cellObj = typeof cell === 'object' && !Array.isArray(cell) && cell.text === undefined && !cell.paragraphs ? cell : (typeof cell === 'string' ? { text: cell } : cell);
        const w = cellObj.width || colWidths[cIdx] || Math.floor(totalW / row.length);
        const span = cellObj.colspan ? `<w:gridSpan w:val="${cellObj.colspan}"/>` : '';
        const vAlign = `<w:vAlign w:val="${cellObj.vAlign || 'center'}"/>`;
        const bgVal = cellObj.bg || (isHeader ? opt.headerBg : null);
        const shd = bgVal ? `<w:shd w:val="clear" w:color="auto" w:fill="${bgVal}"/>` : '';
        const tcBorders = cellObj.noBorder ? `<w:tcBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/></w:tcBorders>` : '';

        const tcPr = `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span}${shd}${vAlign}${tcBorders}</w:tcPr>`;

        let pContent = '';
        if (cellObj.xml) {
          pContent = cellObj.xml;
        } else if (Array.isArray(cellObj.paragraphs)) {
          pContent = cellObj.paragraphs.map(cp => typeof cp === 'string' ? wP(cp, { align: cellObj.align || 'left' }) : wP(cp.runs || cp.text, cp)).join('');
        } else {
          const bold = cellObj.bold !== undefined ? cellObj.bold : (isHeader && opt.headerBold !== false);
          const align = cellObj.align || opt.alignCols?.[cIdx] || (isHeader ? 'center' : 'left');
          pContent = wP(cellObj.text || '', { bold, align, color: cellObj.color || (isHeader ? '0F172A' : '334155'), size: cellObj.size || (isHeader ? 21 : 20) });
        }
        tcXml += `<w:tc>${tcPr}${pContent}</w:tc>`;
      });
      trXml += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${tcXml}</w:tr>`;
    });

    return `<w:tbl>${tblPr}${tblGrid}${trXml}</w:tbl>`;
  }

  // --- 构造完整 DOCX 报表 XML ---
  function buildDocumentXml(data) {
    const { exam, paperId, paperMeta, student, results, DATA, scores } = data;
    const d = DATA[exam];
    const r = results || {};

    let body = '';

    // ① 主报表标题区 (Header)
    body += wP([
      { text: 'CAMBRIDGE ASSESSMENT ENGLISH · MOCK TEST PROGRESS REPORT', size: 18, color: '64748B', bold: true }
    ], { align: 'center', spaceBefore: 0, spaceAfter: 60 });

    body += wP([
      { text: 'OBJECTIVE-SKILLS PROGRESS REPORT', size: 34, color: '0F172A', bold: true }
    ], { align: 'center', spaceBefore: 60, spaceAfter: 80 });

    body += wP([
      { text: `${d.reportTemplate.examName || d.title} · ${paperMeta.label} (${paperId})`, size: 24, color: '1D4ED8', bold: true }
    ], { align: 'center', spaceBefore: 0, spaceAfter: 200 });

    // ② 考生信息表 (4列优雅 Morandi 表格)
    const metaRows = [
      [
        { text: 'Candidate name (考生姓名)', bold: true, bg: 'F1F5F9', color: '475569', width: 2200 },
        { text: student.name || '—', bold: true, color: '0F172A', width: 2600 },
        { text: 'Place of entry (考点)', bold: true, bg: 'F1F5F9', color: '475569', width: 2200 },
        { text: student.place || 'BEIJING', color: '0F172A', width: 2600 }
      ],
      [
        { text: 'Local reference (准考证号)', bold: true, bg: 'F1F5F9', color: '475569', width: 2200 },
        { text: student.id || '—', color: '0F172A', width: 2600 },
        { text: 'Session (考试场次)', bold: true, bg: 'F1F5F9', color: '475569', width: 2200 },
        { text: student.session || '—', color: '0F172A', width: 2600 }
      ],
      [
        { text: 'Exam & Paper (试卷级别)', bold: true, bg: 'F1F5F9', color: '475569', width: 2200 },
        { text: `${exam} · ${paperMeta.label}`, bold: true, color: '1D4ED8', width: 2600 },
        { text: 'Report Date (报告日期)', bold: true, bg: 'F1F5F9', color: '475569', width: 2200 },
        { text: r.at || new Date().toLocaleString(), color: '0F172A', width: 2600 }
      ]
    ];
    body += wTable(metaRows, { width: 9600, borderColor: 'CBD5E1', paddingTop: 100, paddingBottom: 100 });

    // 报告状态说明条 (提示教师补全)
    const statusBox = [
      [
        {
          bg: 'EFF6FF',
          borderColor: '93C5FD',
          paragraphs: [
            { runs: [{ text: '【报告状态说明】 当前为客观题阶段报告（REPORT STATUS: 待教师线下补充主观题成绩）', bold: true, color: '1D4ED8', size: 21 }], align: 'left', spaceBefore: 60, spaceAfter: 40 },
            { runs: [{ text: '• 听力与阅读部分已由在线测评系统自动批改并生成原始分、量表分与诊断建议。', color: '334155', size: 19 }], spaceBefore: 20, spaceAfter: 20 },
            { runs: [{ text: '• 写作与口语部分为线下作答任务，本 Word 报告已为您严格预留标准评分卡、分项评分表与大容量评语书写框，支持直接在 Word 中录入或打印手填。', color: '334155', size: 19 }], spaceBefore: 20, spaceAfter: 60 }
          ]
        }
      ]
    ];
    body += '<w:p><w:pPr><w:spacing w:before="120" w:after="120"/></w:pPr></w:p>';
    body += wTable(statusBox, { width: 9600, borderColor: '93C5FD', paddingTop: 120, paddingBottom: 120 });

    // ③ AUTO-SCORED 客观题成绩汇总表 (Listening & Reading)
    body += '<w:p><w:pPr><w:spacing w:before="240" w:after="100"/></w:pPr></w:p>';
    body += wP([
      { text: '一、AUTO-SCORED · 听力与阅读客观题成绩', size: 24, bold: true, color: '0F172A' }
    ], { spaceBefore: 160, spaceAfter: 100 });

    const lScore = scores.listening;
    const rScore = scores.reading;
    const lMod = d.modules.find(m => m.id === 'listening');
    const rMod = d.modules.find(m => m.id === 'reading');

    const scoreTableRows = [
      [
        { text: '考试模块 (Module)', width: 2000 },
        { text: '原始得分 (Raw Score)', width: 1900 },
        { text: 'Cambridge English Scale', width: 2200 },
        { text: 'CEFR 对应等级', width: 1600 },
        { text: '成绩评定等级 (Band)', width: 1900 }
      ],
      [
        { text: 'Listening 听力', bold: true, width: 2000 },
        { text: `${lScore.raw} / ${lMod?.maxRaw || 25}`, align: 'center', width: 1900 },
        { text: lScore.below ? `<${lScore.minScale} (低于报告范围)` : String(lScore.scale), bold: true, align: 'center', color: lScore.below ? 'DC2626' : '1D4ED8', width: 2200 },
        { text: lScore.below ? 'Below A2' : (d.reportTemplate.cefr ? d.reportTemplate.cefr(lScore.scale) : '—'), align: 'center', width: 1600 },
        { text: lScore.below ? 'Not reported' : d.reportTemplate.band(lScore.scale), align: 'center', width: 1900 }
      ],
      [
        { text: 'Reading 阅读与读写', bold: true, width: 2000 },
        { text: `${rScore.raw} / ${rMod?.maxRaw || 32}`, align: 'center', width: 1900 },
        { text: rScore.below ? `<${rScore.minScale} (低于报告范围)` : String(rScore.scale), bold: true, align: 'center', color: rScore.below ? 'DC2626' : '1D4ED8', width: 2200 },
        { text: rScore.below ? 'Below A2' : (d.reportTemplate.cefr ? d.reportTemplate.cefr(rScore.scale) : '—'), align: 'center', width: 1600 },
        { text: rScore.below ? 'Not reported' : d.reportTemplate.band(rScore.scale), align: 'center', width: 1900 }
      ]
    ];
    body += wTable(scoreTableRows, { width: 9600, headerBg: 'F1F5F9', headerBold: true, alignCols: ['left', 'center', 'center', 'center', 'center'], borderColor: 'CBD5E1' });

    // ④ OFFLINE ASSESSMENT 教师批改填写区 (Writing & Speaking) - 严格留足空位
    body += '<w:p><w:pPr><w:spacing w:before="300" w:after="100"/></w:pPr></w:p>';
    body += wP([
      { text: '二、OFFLINE ASSESSMENT · 教师批改填写区 (写作与口语)', size: 24, bold: true, color: '0F172A' }
    ], { spaceBefore: 200, spaceAfter: 60 });
    body += wP([
      { text: '写作与口语为线下实操任务。请执教教师依据官方评分量表在以下预留空位中填写打分、评语与签名。', size: 19, color: '64748B' }
    ], { spaceBefore: 0, spaceAfter: 140 });

    const wMod = d.modules.find(m => m.id === 'writing');
    const sMod = d.modules.find(m => m.id === 'speaking');

    // --- 4.1 WRITING 写作教师批改卡 ---
    body += wP([
      { text: `【WRITING 写作测评卡】 满分: ${wMod?.maxRaw || 40} 分 (教师填写)`, size: 21, bold: true, color: '0F172A' }
    ], { spaceBefore: 120, spaceAfter: 80 });

    const writingRubricRows = exam === 'PET' ? [
      [
        { text: '写作任务部分', width: 1800 },
        { text: '内容完整度\nContent (/5)', width: 1800 },
        { text: '交流得体度\nComm. Achiev. (/5)', width: 2000 },
        { text: '组织结构\nOrganisation (/5)', width: 2000 },
        { text: '语言运用\nLanguage (/5)', width: 2000 }
      ],
      [
        { text: 'Part 1 实用书信\n(Email 100词)', bold: true, width: 1800 },
        { text: '[      ] / 5', align: 'center', width: 1800 },
        { text: '[      ] / 5', align: 'center', width: 2000 },
        { text: '[      ] / 5', align: 'center', width: 2000 },
        { text: '[      ] / 5', align: 'center', width: 2000 }
      ],
      [
        { text: 'Part 2 文章/故事\n(Article/Story 100词)', bold: true, width: 1800 },
        { text: '[      ] / 5', align: 'center', width: 1800 },
        { text: '[      ] / 5', align: 'center', width: 2000 },
        { text: '[      ] / 5', align: 'center', width: 2000 },
        { text: '[      ] / 5', align: 'center', width: 2000 }
      ],
      [
        { text: '写作最终核定得分', bold: true, bg: 'F8FAFC', width: 1800 },
        { colspan: 4, text: `原始分合计: [ ________ ] / ${wMod?.maxRaw || 40}    |    Cambridge Scale 量表分: [ ________ ]    |    CEFR 等级: [ ________ ]`, bold: true, color: '1D4ED8', align: 'center', width: 7800 }
      ]
    ] : [
      [
        { text: '写作任务部分', width: 2400 },
        { text: '内容要点 Content (/5)', width: 2400 },
        { text: '组织衔接 Organisation (/5)', width: 2400 },
        { text: '词汇语法 Language (/5)', width: 2400 }
      ],
      [
        { text: 'Part 6 便条与短邮件 (25+词)', bold: true, width: 2400 },
        { text: '[      ] / 5', align: 'center', width: 2400 },
        { text: '[      ] / 5', align: 'center', width: 2400 },
        { text: '[      ] / 5', align: 'center', width: 2400 }
      ],
      [
        { text: 'Part 7 看图连环写话 (35+词)', bold: true, width: 2400 },
        { text: '[      ] / 5', align: 'center', width: 2400 },
        { text: '[      ] / 5', align: 'center', width: 2400 },
        { text: '[      ] / 5', align: 'center', width: 2400 }
      ],
      [
        { text: '写作最终核定得分', bold: true, bg: 'F8FAFC', width: 2400 },
        { colspan: 3, text: `原始分合计: [ ________ ] / ${wMod?.maxRaw || 30}    |    Cambridge Scale 量表分: [ ________ ]    |    CEFR 等级: [ ________ ]`, bold: true, color: '1D4ED8', align: 'center', width: 7200 }
      ]
    ];
    body += wTable(writingRubricRows, { width: 9600, headerBg: 'F1F5F9', headerBold: true, alignCols: ['left', 'center', 'center', 'center', 'center'], borderColor: 'CBD5E1' });

    // 留足写作评语大空位 (Spacious Comment Area)
    const writingCommentBox = [
      [
        {
          paragraphs: [
            { runs: [{ text: '【写作分项诊断与教师评语】 (请在此处填写针对性反馈，或打印后直接手写)：', bold: true, color: '475569', size: 20 }], spaceBefore: 60, spaceAfter: 60 },
            { runs: [{ text: '1. 审题与要点覆盖 (Content)：____________________________________________________________________________________', color: '64748B', size: 19 }], spaceBefore: 40, spaceAfter: 40 },
            { runs: [{ text: '2. 逻辑组织与分段过渡 (Organisation)：___________________________________________________________________________', color: '64748B', size: 19 }], spaceBefore: 40, spaceAfter: 40 },
            { runs: [{ text: '3. 词汇多样性与句型运用 (Language)：____________________________________________________________________________', color: '64748B', size: 19 }], spaceBefore: 40, spaceAfter: 40 },
            { runs: [{ text: '4. 重点错句修改建议与升格指导：________________________________________________________________________________', color: '64748B', size: 19 }], spaceBefore: 40, spaceAfter: 40 },
            { runs: [{ text: '5. 下一阶段写作专项训练任务：__________________________________________________________________________________', color: '64748B', size: 19 }], spaceBefore: 40, spaceAfter: 60 },
            { runs: [{ text: '批改教师签名：____________________          批改日期：2026年____月____日          审核意见：[  ] 优秀  [  ] 良好  [  ] 需加强', bold: true, color: '1E293B', size: 19 }], spaceBefore: 80, spaceAfter: 60 }
          ]
        }
      ]
    ];
    body += wTable(writingCommentBox, { width: 9600, borderColor: 'CBD5E1', paddingTop: 80, paddingBottom: 80 });

    // --- 4.2 SPEAKING 口语教师批改卡 ---
    body += '<w:p><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr></w:p>';
    body += wP([
      { text: `【SPEAKING 口语测评卡】 满分: ${sMod?.maxRaw || 30} 分 (教师填写)`, size: 21, bold: true, color: '0F172A' }
    ], { spaceBefore: 160, spaceAfter: 80 });

    const speakingRubricRows = exam === 'PET' ? [
      [
        { text: '语法与词汇\nGrammar & Vocab (/5)', width: 1900 },
        { text: '篇章管理与表达\nDiscourse (/5)', width: 1900 },
        { text: '语音语调发音\nPronunciation (/5)', width: 1900 },
        { text: '互动与回应\nInteractive (/5)', width: 1900 },
        { text: '全局整体表现\nGlobal (/5 × 2 = /10)', width: 2000 }
      ],
      [
        { text: '[      ] / 5', align: 'center', width: 1900 },
        { text: '[      ] / 5', align: 'center', width: 1900 },
        { text: '[      ] / 5', align: 'center', width: 1900 },
        { text: '[      ] / 5', align: 'center', width: 1900 },
        { text: '[      ] / 10', align: 'center', width: 2000 }
      ],
      [
        { colspan: 5, text: `口语最终核定得分:    原始分合计: [ ________ ] / ${sMod?.maxRaw || 30}    |    Cambridge Scale 量表分: [ ________ ]    |    CEFR 等级: [ ________ ]`, bold: true, color: '1D4ED8', align: 'center', width: 9600 }
      ]
    ] : [
      [
        { text: '语法与词汇\nGrammar & Vocab (/5)', width: 2400 },
        { text: '语音语调发音\nPronunciation (/5)', width: 2400 },
        { text: '互动与应答\nInteractive (/5)', width: 2400 },
        { text: '全局整体表现\nGlobal (/5 × 2 = /10)', width: 2400 }
      ],
      [
        { text: '[      ] / 5', align: 'center', width: 2400 },
        { text: '[      ] / 5', align: 'center', width: 2400 },
        { text: '[      ] / 5', align: 'center', width: 2400 },
        { text: '[      ] / 10', align: 'center', width: 2400 }
      ],
      [
        { colspan: 4, text: `口语最终核定得分:    原始分合计: [ ________ ] / ${sMod?.maxRaw || 25}    |    Cambridge Scale 量表分: [ ________ ]    |    CEFR 等级: [ ________ ]`, bold: true, color: '1D4ED8', align: 'center', width: 9600 }
      ]
    ];
    body += wTable(speakingRubricRows, { width: 9600, headerBg: 'F1F5F9', headerBold: true, alignCols: ['center', 'center', 'center', 'center', 'center'], borderColor: 'CBD5E1' });

    // 留足口语评语大空位 (Spacious Speaking Comment Area)
    const speakingCommentBox = [
      [
        {
          paragraphs: [
            { runs: [{ text: '【口语实测表现点评与建议】 (请在此处填写面试表现反馈，或打印后直接手写)：', bold: true, color: '475569', size: 20 }], spaceBefore: 60, spaceAfter: 60 },
            { runs: [{ text: '1. 日常交际应答与流利度 (Fluency)：______________________________________________________________________________', color: '64748B', size: 19 }], spaceBefore: 40, spaceAfter: 40 },
            { runs: [{ text: '2. 语音语调自然度与重音节奏 (Pronunciation)：___________________________________________________________________', color: '64748B', size: 19 }], spaceBefore: 40, spaceAfter: 40 },
            { runs: [{ text: '3. 词汇丰富度与句式准确性 (Grammar & Vocab)：___________________________________________________________________', color: '64748B', size: 19 }], spaceBefore: 40, spaceAfter: 40 },
            { runs: [{ text: '4. 考场合作讨论与追问反应 (Interaction)：________________________________________________________________________', color: '64748B', size: 19 }], spaceBefore: 40, spaceAfter: 40 },
            { runs: [{ text: '5. 后续口语提升重点与模考训练要求：____________________________________________________________________________', color: '64748B', size: 19 }], spaceBefore: 40, spaceAfter: 60 },
            { runs: [{ text: '口试考官签名：____________________          测评日期：2026年____月____日          整体等级建议：[  ] B2/B1卓越  [  ] 达标  [  ] 需冲刺', bold: true, color: '1E293B', size: 19 }], spaceBefore: 80, spaceAfter: 60 }
          ]
        }
      ]
    ];
    body += wTable(speakingCommentBox, { width: 9600, borderColor: 'CBD5E1', paddingTop: 80, paddingBottom: 80 });

    // ⑤ OBJECTIVE-SKILLS ANALYSIS 客观题分项诊断与建议
    body += '<w:p><w:pPr><w:spacing w:before="300" w:after="100"/></w:pPr></w:p>';
    body += wP([
      { text: '三、OBJECTIVE-SKILLS ANALYSIS · 客观题诊断与学习建议', size: 24, bold: true, color: '0F172A' }
    ], { spaceBefore: 200, spaceAfter: 80 });

    ['listening', 'reading'].forEach(mId => {
      const mName = mId === 'listening' ? '听力 Listening' : '阅读 Reading';
      const mInfo = r.byModule?.[mId];
      const byPart = (mInfo && mInfo.byPart) || {};
      const entries = Object.entries(byPart).map(([id, st]) => ({ id, name: st.name, raw: st.raw, total: st.total, pct: st.total ? Math.round(st.raw / st.total * 100) : 0 }));
      const strength = entries.filter(e => e.pct >= 80);
      const weak = entries.filter(e => e.pct < 60);

      body += wP([
        { text: `● ${mName} 模块分析：`, size: 21, bold: true, color: '1D4ED8' }
      ], { spaceBefore: 80, spaceAfter: 40 });

      const strText = strength.length ? strength.map(s => `${s.name} (${s.raw}/${s.total}, ${s.pct}%)`).join('、') : '暂无优势板块（得分率需 ≥80%）';
      const weakText = weak.length ? weak.map(w => `${w.name} (${w.raw}/${w.total}, ${w.pct}%)`).join('、') : '无明显薄弱板块（得分率均在 60% 以上）';

      body += wP([
        { text: '  - 优势板块：', bold: true, color: '059669' },
        { text: strText, color: '334155' }
      ], { spaceBefore: 20, spaceAfter: 20 });

      body += wP([
        { text: '  - 待提升板块：', bold: true, color: 'DC2626' },
        { text: weakText, color: '334155' }
      ], { spaceBefore: 20, spaceAfter: 40 });
    });

    // ⑥ BY QUESTION TYPE 题型表现明细表
    body += '<w:p><w:pPr><w:spacing w:before="240" w:after="100"/></w:pPr></w:p>';
    body += wP([
      { text: '四、BY QUESTION TYPE · 客观题各题型表现明细表', size: 24, bold: true, color: '0F172A' }
    ], { spaceBefore: 160, spaceAfter: 80 });

    const typeRows = [
      [
        { text: '所属模块与题型名称', width: 3600 },
        { text: '总题量', width: 1500 },
        { text: '正确数', width: 1500 },
        { text: '错误数', width: 1500 },
        { text: '得分率 (%)', width: 1500 }
      ]
    ];

    Object.entries(r.typeStats || {}).forEach(([k, st]) => {
      const pct = st.total ? Math.round(st.correct / st.total * 100) : 0;
      const modPrefix = k.startsWith('listening') ? '[听力] ' : '[阅读] ';
      typeRows.push([
        { text: modPrefix + st.name, width: 3600 },
        { text: String(st.total), align: 'center', width: 1500 },
        { text: String(st.correct), align: 'center', color: '059669', bold: true, width: 1500 },
        { text: String(st.total - st.correct), align: 'center', color: st.total - st.correct > 0 ? 'DC2626' : '334155', width: 1500 },
        { text: `${pct}%`, align: 'center', bold: true, color: pct >= 80 ? '059669' : pct < 60 ? 'DC2626' : 'D97706', width: 1500 }
      ]);
    });

    body += wTable(typeRows, { width: 9600, headerBg: 'F1F5F9', headerBold: true, alignCols: ['left', 'center', 'center', 'center', 'center'], borderColor: 'CBD5E1' });

    // ⑦ WRONG QUESTION ANALYSIS 错题明细表
    body += '<w:p><w:pPr><w:spacing w:before="240" w:after="100"/></w:pPr></w:p>';
    body += wP([
      { text: `五、WRONG QUESTIONS · 客观题错题明细清单 (共 ${(r.wrongs || []).length} 题)`, size: 24, bold: true, color: '0F172A' }
    ], { spaceBefore: 160, spaceAfter: 80 });

    if ((r.wrongs || []).length === 0) {
      body += wP([
        { text: '🎉 祝贺！本次模考客观题（听力与阅读）全部正确，无任何错题！', bold: true, color: '059669', size: 21 }
      ], { spaceBefore: 60, spaceAfter: 120 });
    } else {
      const wrongRows = [
        [
          { text: '部分 / 题号', width: 2200 },
          { text: '题干内容摘要', width: 3800 },
          { text: '考生作答', width: 1800 },
          { text: '标准答案', width: 1800 }
        ]
      ];
      r.wrongs.forEach(w => {
        wrongRows.push([
          { text: `${w.part} · Q${w.n}`, bold: true, width: 2200 },
          { text: w.stem || '（无题干文字，请结合题图/材料分析）', width: 3800 },
          { text: w.user || '（未作答）', color: 'DC2626', bold: true, width: 1800 },
          { text: String(w.correct), color: '059669', bold: true, width: 1800 }
        ]);
      });
      body += wTable(wrongRows, { width: 9600, headerBg: 'F1F5F9', headerBold: true, borderColor: 'CBD5E1' });
    }

    // ⑧ STATEMENT 官方声明与说明
    body += '<w:p><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr></w:p>';
    const statementBox = [
      [
        {
          bg: 'F8FAFC',
          paragraphs: [
            { runs: [{ text: '【官方声明与测评说明 / Cambridge Assessment Statement】', bold: true, color: '475569', size: 19 }], spaceBefore: 40, spaceAfter: 40 },
            { runs: [{ text: d.reportTemplate.statement || 'This analysis and scoring by the system are a strong indication of the test participant’s knowledge and ability in Cambridge Key/Preliminary tests, but do not represent the participant’s actual performance in the real K/P tests.', italic: true, color: '64748B', size: 18 }], spaceBefore: 20, spaceAfter: 20 },
            { runs: [{ text: '免责声明：本分析与成绩单由在线模考系统根据考生真实作答记录生成，仅作为教学诊断、能力评估与阶段复习参考，不代表剑桥大学考评部正式官方证书。', color: '64748B', size: 18 }], spaceBefore: 20, spaceAfter: 40 }
          ]
        }
      ]
    ];
    body += wTable(statementBox, { width: 9600, borderColor: 'CBD5E1', paddingTop: 80, paddingBottom: 80 });

    // 页面设置 (A4, 210mm x 297mm, margins 18mm)
    body += `<w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1020" w:right="1134" w:bottom="1020" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>`;

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;
  }

  // --- XML 静态资源 ---
  const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const WORD_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:cs="Microsoft YaHei"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
        <w:color w:val="1E293B"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
</w:styles>`;

  // --- 导出主方法 ---
  function generateDocxBlob(data) {
    const docXml = buildDocumentXml(data);
    const zip = new SimpleZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
    zip.file('_rels/.rels', ROOT_RELS_XML);
    zip.file('word/_rels/document.xml.rels', WORD_RELS_XML);
    zip.file('word/styles.xml', STYLES_XML);
    zip.file('word/document.xml', docXml);

    const zipBytes = zip.generate();
    if (typeof Blob !== 'undefined') {
      return new Blob([zipBytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
    }
    return zipBytes;
  }

  function downloadDocx(data, filename) {
    const blob = generateDocxBlob(data);
    const name = filename || `${data.student.name || '考生'}_${data.exam}_${data.paperId}_模考成绩单.docx`;

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return blob;
  }

  return {
    generateDocxBlob,
    downloadDocx,
    buildDocumentXml
  };
});
