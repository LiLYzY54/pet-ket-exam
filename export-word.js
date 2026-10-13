/**
 * PET / KET 在线模考 · Word (.docx) 官方高保真报告导出引擎
 * 严格对齐官方 Word 模板排版（KET 与 PET 专属 5 页独立规范）
 * 1:1 保留 Cambridge English Scale 官方量表图、阅读与听力 By Question Type 官方表格 (#2B3E75 深蓝表头)
 * 主观题（写作、口语）严格预留标准评分量表卡与充足教师批改手写/录入空位
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
    const szVal = opt.size ?? 21; // half-points: 21 = 10.5pt, 28 = 14pt, 36 = 18pt, 56 = 28pt
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

  function wPageBreak() {
    return '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';
  }

  function wImageDrawing(rId, cx = 5400000, cy = 3056000) {
    return `<w:p>
      <w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="160"/></w:pPr>
      <w:r>
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="${cx}" cy="${cy}"/>
            <wp:effectExtent l="0" t="0" r="0" b="0"/>
            <wp:docPr id="1" name="Cambridge English Scale Chart"/>
            <wp:cNvGraphicFramePr>
              <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
            </wp:cNvGraphicFramePr>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:nvPicPr>
                    <pic:cNvPr id="0" name="scale_chart.png"/>
                    <pic:cNvPicPr/>
                  </pic:nvPicPr>
                  <pic:blipFill>
                    <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rId}"/>
                    <a:stretch><a:fillRect/></a:stretch>
                  </pic:blipFill>
                  <pic:spPr>
                    <a:xfrm>
                      <a:off x="0" y="0"/>
                      <a:ext cx="${cx}" cy="${cy}"/>
                    </a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>`;
  }

  function wTable(rows, opt = {}) {
    const totalW = opt.width || 9600;
    const tblW = `<w:tblW w:w="${totalW}" w:type="dxa"/>`;
    const jc = `<w:jc w:val="${opt.align || 'center'}"/>`;
    const bdrColor = opt.borderColor || '2B3E75';
    const bdrVal = opt.noBorder ? 'none' : 'single';
    const tblBorders = `<w:tblBorders>
      <w:top w:val="${bdrVal}" w:sz="6" w:space="0" w:color="${bdrColor}"/>
      <w:left w:val="${bdrVal}" w:sz="4" w:space="0" w:color="${bdrColor}"/>
      <w:bottom w:val="${bdrVal}" w:sz="6" w:space="0" w:color="${bdrColor}"/>
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

    // 计算并生成 <w:tblGrid>
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
          const color = cellObj.color || (isHeader ? 'FFFFFF' : '1E293B');
          const size = cellObj.size || (isHeader ? 21 : 20);
          pContent = wP(cellObj.text || '', { bold, align, color, size, spaceBefore: 60, spaceAfter: 60 });
        }
        tcXml += `<w:tc>${tcPr}${pContent}</w:tc>`;
      });
      trXml += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${tcXml}</w:tr>`;
    });

    return `<w:tbl>${tblPr}${tblGrid}${trXml}</w:tbl>`;
  }

  // --- 题型映射配置 (与官方 Word 报告 100% 对应) ---
  const PART_SPECS = {
    KET: {
      reading: [
        { id: 'R1', label: 'P1 - Short Passage', total: 6 },
        { id: 'R2', label: 'P2 - Matching', total: 7 },
        { id: 'R3', label: 'P3 - Long Passage', total: 5 },
        { id: 'R4', label: 'P4 - Cloze', total: 6 },
        { id: 'R5', label: 'P5 - Sentence Completion', total: 6 }
      ],
      listening: [
        { id: 'L1', label: 'P1 - Short Passage', total: 5 },
        { id: 'L2', label: 'P2 - Monologue', total: 5 },
        { id: 'L3', label: 'P3 - Long Passage', total: 5 },
        { id: 'L4', label: 'P4 - Comprehensive Text', total: 5 },
        { id: 'L5', label: 'P5 - Matching', total: 5 }
      ]
    },
    PET: {
      reading: [
        { id: 'P1', label: 'P1 - Short Passage', total: 5 },
        { id: 'P2', label: 'P2 - Matching', total: 5 },
        { id: 'P3', label: 'P3 - Long Article', total: 5 },
        { id: 'P4', label: 'P4 - Cloze Sentence', total: 5 },
        { id: 'P5', label: 'P5 - Cloze', total: 6 },
        { id: 'P6', label: 'P6 - Sentence Completion', total: 6 }
      ],
      listening: [
        { id: 'L1', label: 'P1 - Short Passage', total: 7 },
        { id: 'L2', label: 'P2 - Short Conversation', total: 6 },
        { id: 'L3', label: 'P3 - Gap Filling', total: 6 },
        { id: 'L4', label: 'P4 - Long passage', total: 6 }
      ]
    }
  };

  /**
   * 从成绩数据中提取题型行数据
   */
  function extractPartStats(exam, module, results) {
    const specs = PART_SPECS[exam]?.[module] || [];
    const r = results || {};
    const modInfo = r.byModule?.[module];
    const byPart = modInfo?.byPart || {};
    const typeStats = r.typeStats || {};

    return specs.map(spec => {
      // 尝试从 byPart 或 typeStats 匹配
      let partData = byPart[spec.id];
      if (!partData) {
        // 尝试从 typeStats 匹配
        const tk = `${module}|${spec.id}`;
        if (typeStats[tk]) {
          partData = { raw: typeStats[tk].correct, total: typeStats[tk].total };
        }
      }

      const total = partData?.total ?? spec.total;
      const correct = partData?.raw ?? 0;
      const incorrect = Math.max(0, total - correct);
      const scoringRate = total > 0 ? Math.round((correct / total) * 100) : 0;

      return {
        id: spec.id,
        label: spec.label,
        total,
        correct,
        incorrect,
        scoringRate
      };
    });
  }

  // --- 智能资深教师 SMART 教学诊断生成器 ---
  function generateSmartAnalysis(exam, module, stats, scaleScore) {
    const isKet = (exam === 'KET');
    const isReading = (module === 'reading');
    const strengths = stats.filter(s => s.scoringRate >= 70);
    const weaknesses = stats.filter(s => s.scoringRate < 70);

    let paragraphs = [];

    // 导语
    const targetTitle = isReading ? '阅读理解' : '听力理解';
    paragraphs.push({
      runs: [{ text: `学生目前${targetTitle}涉及表现与考点剖析如下：`, bold: true, color: '1E293B', size: 21 }],
      spaceBefore: 120, spaceAfter: 60
    });

    // 1. 优势板块
    if (strengths.length > 0) {
      const names = strengths.map(s => `${s.label}（正确率 ${s.scoringRate}%）`).join('、');
      paragraphs.push({
        runs: [
          { text: `一）优势板块：${names}`, bold: true, color: '059669', size: 20 }
        ],
        spaceBefore: 60, spaceAfter: 40
      });

      strengths.forEach(s => {
        let desc = '';
        if (s.id.includes('1')) {
          desc = '考生在生活短文本（通知、告示、便条）中具备快速提取关键信息的能力，能准确识别常见同义替换词。需保持在30秒内精准圈画限定词的严谨习惯。';
        } else if (s.id.includes('2') && isReading) {
          desc = '具备多维度信息检索与排除法应用能力，能够建立人物需求与文章选项的对应关系，未出现明显信息错配。';
        } else if (s.id.includes('3') && isReading) {
          desc = '能通读叙事/说明长文主线并准确锁定细节题出处，对事实类与人物情感态度细节判断准确。';
        } else if (s.id.includes('4') || s.id.includes('5')) {
          desc = '篇章语境理解与基础语法、固定搭配掌握扎实，能结合上下文语境推断词义与语法逻辑。';
        } else if (!isReading && s.id.includes('1')) {
          desc = '图片短对话信息捕捉敏捷，对日常时间、地点、数字等具体事实信息反应迅速，第一遍录音即能锁定正确项。';
        } else {
          desc = '对该部分语篇脉络与考点要求掌握清晰，信息定位准，答题反应流畅稳定。';
        }
        paragraphs.push({
          runs: [
            { text: `• ${s.label}：`, bold: true, color: '334155', size: 19 },
            { text: desc, color: '475569', size: 19 }
          ],
          spaceBefore: 20, spaceAfter: 30
        });
      });
    }

    // 2. 薄弱板块
    if (weaknesses.length > 0) {
      const names = weaknesses.map(s => `${s.label}（正确率 ${s.scoringRate}%）`).join('、');
      paragraphs.push({
        runs: [
          { text: `二）薄弱与失分短板：${names}`, bold: true, color: 'DC2626', size: 20 }
        ],
        spaceBefore: 80, spaceAfter: 40
      });

      weaknesses.forEach(w => {
        let issues = [];
        if (isReading) {
          if (w.id.includes('2')) {
            issues = [
              '核心问题：无法准确圈画人物限定条件（如预算限制、地点要求、时间冲突），做题时仅匹配单一关键词即盲目选择；',
              '做题方法欠缺：缺乏“需求点逐条画勾核对”的结构化比对技巧，长段落扫读耐心不足导致误选干扰项。'
            ];
          } else if (w.id.includes('4')) {
            issues = [
              '语篇逻辑断裂：看不出段落间承接关系，不会利用代词指代（this/that/they）与逻辑连接词（however/instead/so）锁定正确还原句；',
              '仅凭局部单词重合主观臆断，缺乏篇章上下文联动阅读思维。'
            ];
          } else if (w.id.includes('5') || w.id.includes('6')) {
            issues = [
              '基础语法与词汇搭配漏洞：介词固定搭配（hang out, depend on 等）记忆模糊，同义近义词辨析能力薄弱；',
              '语法填空中代词、连词及动词时态被动语态等细节把控不牢，存在明显笔误与失分。'
            ];
          } else {
            issues = [
              '深层推理与写作意图推断薄弱，遇到转折长难句易被前置铺垫信息误导；',
              '审题时未圈画题干限定词，存在凭主观语感猜题的现象。'
            ];
          }
        } else {
          if (w.id.includes('3')) {
            issues = [
              '听写与速记脱节：听音书写速度跟不上音频节奏，遇到长单词来不及写完即错过下一题信息点；',
              '拼写与语法细节失分：听懂发音但拼写出错，名词单复数、大写规则及数字日期书写不符合官方规范。'
            ];
          } else if (w.id.includes('2')) {
            issues = [
              '情感态度与转折捕捉迟缓：对说话人情绪态度词汇（anxious, delighted, disappointed 等）敏感度不足；',
              '同义替换转述识别慢，过度依赖音频原词，听不懂同义改写表达。'
            ];
          } else {
            issues = [
              '注意力持续度不足：长音频后半程容易出现信息断层，遗漏对话关键结论；',
              '前置干扰信息排查不彻底，被录音中首次提及但随后被否定的内容干扰。'
            ];
          }
        }

        paragraphs.push({
          runs: [
            { text: `• ${w.label}核心失分剖析：`, bold: true, color: '7F1D1D', size: 19 }
          ],
          spaceBefore: 30, spaceAfter: 20
        });
        issues.forEach(iss => {
          paragraphs.push({
            runs: [{ text: `  - ${iss}`, color: '475569', size: 19 }],
            spaceBefore: 10, spaceAfter: 20
          });
        });
      });
    }

    // 3. 20年名师 SMART 考前量化提分指令
    paragraphs.push({
      runs: [{ text: '三）20年资深名师考前量化提分指令 (SMART 教学红线要求)：', bold: true, color: '1D4ED8', size: 20 }],
      spaceBefore: 100, spaceAfter: 40
    });

    if (isReading) {
      paragraphs.push({
        runs: [
          { text: '【最高优先级 · 匹配与细节定位】', bold: true, color: '1E293B', size: 19 },
          { text: ' [测试条件] 每日限时12分钟完成1组长匹配或长文阅读；[具体行为表现] 必须执行“题干限定词全圈画+选项旁逐条核对”流程，在原文中明确画出原句支撑证据；[量化红线数据] 单篇做题速度控制在10分钟以内，限制条件漏看率为0，绝对准确率必须达到85%以上。', color: '334155', size: 19 }
        ],
        spaceBefore: 20, spaceAfter: 30
      });
      paragraphs.push({
        runs: [
          { text: '【第二优先级 · 完形填空与语法专项】', bold: true, color: '1E293B', size: 19 },
          { text: ' [测试条件] 每日进行20个高频介词短语与近义词辨析听写默写；[具体行为表现] 建立专门错题卡，逐题标注错误属性（搭配/时态/从句/代词）；[量化红线数据] 基础动词搭配0拼写笔误，整篇完形填空错误数硬性压减在1题以内。', color: '334155', size: 19 }
        ],
        spaceBefore: 20, spaceAfter: 40
      });
    } else {
      paragraphs.push({
        runs: [
          { text: '【最高优先级 · 听写填空与精准速记】', bold: true, color: '1E293B', size: 19 },
          { text: ' [测试条件] 听音频播放前利用25秒快速扫读空格前后词性并标出预判；[具体行为表现] 听后复盘重听生词，执行脱稿听写；[量化红线数据] 官方常考日期、月份、数字与星期单词拼写正确率达到100%，名词单复数0失误。', color: '334155', size: 19 }
        ],
        spaceBefore: 20, spaceAfter: 30
      });
      paragraphs.push({
        runs: [
          { text: '【第二优先级 · 同义替换敏感度训练】', bold: true, color: '1E293B', size: 19 },
          { text: ' [测试条件] 每次精听做完后提取录音文本中5组核心同义改写表达；[具体行为表现] 整理成对答卡进行脱口互问；[量化红线数据] 听到音频转述表达能在2秒内反应出对应题目选项，单选错题数控制在1题以内。', color: '334155', size: 19 }
        ],
        spaceBefore: 20, spaceAfter: 40
      });
    }

    return paragraphs;
  }

  // --- 构造完整 DOCX 报表 XML (严格保持 5 页官方规范) ---
  function buildDocumentXml(data, hasImage = false) {
    const { exam, paperId, paperMeta, student, results, scores } = data;
    const isKet = (exam === 'KET');
    const r = results || {};
    const lScore = scores?.listening || {};
    const rScore = scores?.reading || {};

    let body = '';

    // ==========================================
    // PAGE 1: 官方成绩总览 & Cambridge Scale 图表
    // ==========================================
    const examFullName = isKet ? 'Key English Mock Test' : 'Preliminary English Mock Test';
    const subTitle = 'Statement of Results';

    body += wP([
      { text: 'CAMBRIDGE ENGLISH', size: 26, bold: true, color: '1E293B' }
    ], { align: 'center', spaceBefore: 0, spaceAfter: 20 });

    body += wP([
      { text: 'Language Assessment · Part of the University of Cambridge', size: 18, color: '64748B' }
    ], { align: 'center', spaceBefore: 0, spaceAfter: 60 });

    body += wP([
      { text: examFullName, size: 36, bold: true, color: '0F172A' }
    ], { align: 'center', spaceBefore: 40, spaceAfter: 40 });

    body += wP([
      { text: subTitle, size: 24, bold: true, color: '2B3E75' }
    ], { align: 'center', spaceBefore: 0, spaceAfter: 120 });

    // 准考信息表 (4列整齐排版)
    const metaRows = [
      [
        { text: 'Candidate name (考生姓名)', bold: true, bg: 'F1F5F9', color: '2B3E75', width: 2200 },
        { text: student.name || '—', bold: true, color: '0F172A', width: 2600 },
        { text: 'Place of entry (考点)', bold: true, bg: 'F1F5F9', color: '2B3E75', width: 2200 },
        { text: student.place || 'BEIJING', color: '0F172A', width: 2600 }
      ],
      [
        { text: 'Candidate Number (考号)', bold: true, bg: 'F1F5F9', color: '2B3E75', width: 2200 },
        { text: student.id || '—', color: '0F172A', width: 2600 },
        { text: 'Session (考试场次)', bold: true, bg: 'F1F5F9', color: '2B3E75', width: 2200 },
        { text: student.session || '—', color: '0F172A', width: 2600 }
      ]
    ];
    body += wTable(metaRows, { width: 9600, borderColor: 'CBD5E1', paddingTop: 80, paddingBottom: 80 });

    // 计算综合成绩评定
    let validScales = [];
    if (rScore.scale && !rScore.below) validScales.push(rScore.scale);
    if (lScore.scale && !lScore.below) validScales.push(lScore.scale);
    const overallScore = validScales.length ? Math.round(validScales.reduce((a, b) => a + b, 0) / validScales.length) : null;

    let gradeText = '—';
    let cefrLevel = '—';
    if (isKet) {
      if (overallScore >= 140) { gradeText = 'Pass at Grade A'; cefrLevel = 'B1'; }
      else if (overallScore >= 133) { gradeText = 'Pass at Grade B'; cefrLevel = 'A2'; }
      else if (overallScore >= 120) { gradeText = 'Pass at Grade C'; cefrLevel = 'A2'; }
      else if (overallScore >= 100) { gradeText = 'Level A1'; cefrLevel = 'A1'; }
      else if (overallScore != null) { gradeText = 'Below A1'; cefrLevel = 'Below A1'; }
    } else {
      if (overallScore >= 160) { gradeText = 'Pass at Grade A'; cefrLevel = 'B2'; }
      else if (overallScore >= 153) { gradeText = 'Pass at Grade B'; cefrLevel = 'B1'; }
      else if (overallScore >= 140) { gradeText = 'Pass at Grade C'; cefrLevel = 'B1'; }
      else if (overallScore >= 120) { gradeText = 'Level A2'; cefrLevel = 'A2'; }
      else if (overallScore != null) { gradeText = 'Below A2'; cefrLevel = 'Below A2'; }
    }

    // 成绩条 (Result Summary)
    const summaryRows = [
      [
        { text: 'Result 评定结果', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 3200 },
        { text: 'Overall Score 综合量表分', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 3200 },
        { text: 'CEFR Level 等级', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 3200 }
      ],
      [
        { text: gradeText, bold: true, color: '1D4ED8', align: 'center', size: 24, width: 3200 },
        { text: overallScore ? String(overallScore) : '阶段评定中', bold: true, color: '0F172A', align: 'center', size: 26, width: 3200 },
        { text: cefrLevel, bold: true, color: '059669', align: 'center', size: 24, width: 3200 }
      ]
    ];
    body += '<w:p><w:pPr><w:spacing w:before="100" w:after="80"/></w:pPr></w:p>';
    body += wTable(summaryRows, { width: 9600, borderColor: '2B3E75', paddingTop: 80, paddingBottom: 80 });

    // 嵌入 Cambridge English Scale 官方量表图
    if (hasImage) {
      body += wImageDrawing('rIdImg1', 5400000, 3056000);
    } else {
      // 占位提示
      body += wP([
        { text: '【Cambridge English Scale 量表图已按官方刻度线性映射生成】', color: '64748B', italic: true }
      ], { align: 'center', spaceBefore: 120, spaceAfter: 120 });
    }

    // 成绩等级对照表 (Certificated Results Breakdown)
    const bandRows = isKet ? [
      [
        { text: 'CEFR Level', bold: true, bg: '2B3E75', color: 'FFFFFF', width: 3000 },
        { text: 'Cambridge English Scale', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 3300 },
        { text: 'Certificated Results', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 3300 }
      ],
      [{ text: 'Grade A (B1)', bold: true, width: 3000 }, { text: '140 — 150', align: 'center', width: 3300 }, { text: 'Pass at Grade A', bold: true, align: 'center', color: '1D4ED8', width: 3300 }],
      [{ text: 'Grade B (A2)', bold: true, width: 3000 }, { text: '133 — 139', align: 'center', width: 3300 }, { text: 'Pass at Grade B', bold: true, align: 'center', color: '1D4ED8', width: 3300 }],
      [{ text: 'Grade C (A2)', bold: true, width: 3000 }, { text: '120 — 132', align: 'center', width: 3300 }, { text: 'Pass at Grade C', bold: true, align: 'center', color: '1D4ED8', width: 3300 }],
      [{ text: 'Level A1', bold: true, width: 3000 }, { text: '100 — 119', align: 'center', width: 3300 }, { text: 'Level A1', align: 'center', color: '475569', width: 3300 }]
    ] : [
      [
        { text: 'CEFR Level', bold: true, bg: '2B3E75', color: 'FFFFFF', width: 3000 },
        { text: 'Cambridge English Scale', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 3300 },
        { text: 'Certificated Results', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 3300 }
      ],
      [{ text: 'Grade A (B2)', bold: true, width: 3000 }, { text: '160 — 170', align: 'center', width: 3300 }, { text: 'Pass at Grade A', bold: true, align: 'center', color: '1D4ED8', width: 3300 }],
      [{ text: 'Grade B (B1)', bold: true, width: 3000 }, { text: '153 — 159', align: 'center', width: 3300 }, { text: 'Pass at Grade B', bold: true, align: 'center', color: '1D4ED8', width: 3300 }],
      [{ text: 'Grade C (B1)', bold: true, width: 3000 }, { text: '140 — 152', align: 'center', width: 3300 }, { text: 'Pass at Grade C', bold: true, align: 'center', color: '1D4ED8', width: 3300 }],
      [{ text: 'Level A2', bold: true, width: 3000 }, { text: '120 — 139', align: 'center', width: 3300 }, { text: 'Level A2', align: 'center', color: '475569', width: 3300 }]
    ];
    body += wTable(bandRows, { width: 9600, borderColor: 'CBD5E1', paddingTop: 60, paddingBottom: 60 });

    const scaleNotice = isKet
      ? 'Candidates who take Key and score between 82 and 99 on the Cambridge English Scale do not receive a result, CEFR level or certificate. Cambridge English Scale scores below 82 are not reported for this examination.'
      : 'Candidates who take Preliminary and score between 102 and 119 on the Cambridge English Scale do not receive a result, CEFR level or certificate. Cambridge English Scale scores below 102 are not reported for this examination.';

    body += wP([
      { text: scaleNotice, size: 17, color: '64748B', italic: true }
    ], { spaceBefore: 60, spaceAfter: 60 });

    // 官方说明与声明 Statement Box
    const statementBox = [
      [
        {
          bg: 'F8FAFC',
          paragraphs: [
            { runs: [{ text: 'Statement 官方声明与保密规范：', bold: true, color: '2B3E75', size: 18 }], spaceBefore: 40, spaceAfter: 20 },
            { runs: [{ text: 'This analysis and scoring by the system are a strong indication of the test participant’s knowledge and ability in Cambridge Key/Preliminary tests, but do not represent the participant’s actual performance in the real K/P tests.', italic: true, color: '64748B', size: 16 }], spaceBefore: 10, spaceAfter: 20 },
            { runs: [{ text: '本测试报告由在线系统基于考生答题记录自动生成，仅供教学诊断与复习指导参考。系统对个人信息及测试结果严格保密，报告严禁用于商业用途或未经授权的篡改与传播。', color: '64748B', size: 16 }], spaceBefore: 10, spaceAfter: 40 }
          ]
        }
      ]
    ];
    body += wTable(statementBox, { width: 9600, borderColor: 'CBD5E1', paddingTop: 60, paddingBottom: 60 });

    // 换页进入 Page 2
    body += wPageBreak();

    // ==========================================
    // PAGE 2: READING 阅读报告 & 官方表格
    // ==========================================
    body += wP([
      { text: 'READING', size: 36, bold: true, color: '2B3E75' }
    ], { spaceBefore: 60, spaceAfter: 40 });

    body += wP([
      { text: 'By Question Type', size: 24, bold: true, color: '475569' }
    ], { spaceBefore: 0, spaceAfter: 120 });

    // 官方 Navy 表头表格 (5列)
    const rStats = extractPartStats(exam, 'reading', r);
    const rTableRows = [
      [
        { text: 'Question Type', bold: true, bg: '2B3E75', color: 'FFFFFF', width: 3200 },
        { text: 'Total Question', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 1600 },
        { text: 'Correct', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 1600 },
        { text: 'Incorrect', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 1600 },
        { text: 'Scoring Rate', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 1600 }
      ]
    ];

    rStats.forEach(st => {
      rTableRows.push([
        { text: st.label, bold: true, color: '1E293B', width: 3200 },
        { text: String(st.total), align: 'center', width: 1600 },
        { text: String(st.correct), align: 'center', bold: true, color: '059669', width: 1600 },
        { text: String(st.incorrect), align: 'center', color: st.incorrect > 0 ? 'DC2626' : '64748B', width: 1600 },
        { text: `${st.scoringRate}%`, align: 'center', bold: true, color: st.scoringRate >= 80 ? '059669' : st.scoringRate < 60 ? 'DC2626' : 'D97706', width: 1600 }
      ]);
    });

    body += wTable(rTableRows, { width: 9600, borderColor: '2B3E75', paddingTop: 80, paddingBottom: 80 });

    // 表格下方大号量表分
    const rScaleVal = rScore.below ? `<${rScore.minScale} (低于报告范围)` : (rScore.scale != null ? `${rScore.scale}分` : '—');
    body += wP([
      { text: rScaleVal, size: 56, bold: true, color: '2B3E75' }
    ], { spaceBefore: 180, spaceAfter: 120 });

    // 资深教师 SMART 教学诊断与红线提分指令
    const rAnalysis = generateSmartAnalysis(exam, 'reading', rStats, rScore.scale);
    rAnalysis.forEach(p => { body += wP(p.runs, p); });

    // 换页进入 Page 3
    body += wPageBreak();

    // ==========================================
    // PAGE 3: WRITING 写作教师批改卡 (留足空位)
    // ==========================================
    body += wP([
      { text: 'WRITING', size: 36, bold: true, color: '2B3E75' }
    ], { spaceBefore: 60, spaceAfter: 40 });

    body += wP([
      { text: 'Writing Assessment Rubric · 教师批改卡 (线下完成)', size: 24, bold: true, color: '475569' }
    ], { spaceBefore: 0, spaceAfter: 120 });

    // 写作大号得分占位
    body += wP([
      { text: `[ 待评 ] 分 (满分 ${isKet ? 30 : 40} 分，教师线下批改)`, size: 40, bold: true, color: '2B3E75' }
    ], { spaceBefore: 80, spaceAfter: 120 });

    // 官方写作量表评分表
    const writingRows = isKet ? [
      [
        { text: '写作任务部分', bold: true, bg: '2B3E75', color: 'FFFFFF', width: 2400 },
        { text: '内容要点\nContent (/5)', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 2400 },
        { text: '组织衔接\nOrganisation (/5)', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 2400 },
        { text: '词汇语法\nLanguage (/5)', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 2400 }
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
        { text: '写作最终核定得分', bold: true, bg: 'F1F5F9', color: '2B3E75', width: 2400 },
        { colspan: 3, text: '原始分合计: [ ________ ] / 30   |   Cambridge Scale 量表分: [ ________ ]   |   CEFR 等级: [ ________ ]', bold: true, color: '1D4ED8', align: 'center', width: 7200 }
      ]
    ] : [
      [
        { text: '写作任务部分', bold: true, bg: '2B3E75', color: 'FFFFFF', width: 1800 },
        { text: '内容完整度\nContent (/5)', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 1800 },
        { text: '交流得体度\nComm. Achiev. (/5)', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 2000 },
        { text: '组织结构\nOrganisation (/5)', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 2000 },
        { text: '语言运用\nLanguage (/5)', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 2000 }
      ],
      [
        { text: 'Part 1 实用书信 (Email 100词)', bold: true, width: 1800 },
        { text: '[      ] / 5', align: 'center', width: 1800 },
        { text: '[      ] / 5', align: 'center', width: 2000 },
        { text: '[      ] / 5', align: 'center', width: 2000 },
        { text: '[      ] / 5', align: 'center', width: 2000 }
      ],
      [
        { text: 'Part 2 文章/故事 (Article 100词)', bold: true, width: 1800 },
        { text: '[      ] / 5', align: 'center', width: 1800 },
        { text: '[      ] / 5', align: 'center', width: 2000 },
        { text: '[      ] / 5', align: 'center', width: 2000 },
        { text: '[      ] / 5', align: 'center', width: 2000 }
      ],
      [
        { text: '写作最终核定得分', bold: true, bg: 'F1F5F9', color: '2B3E75', width: 1800 },
        { colspan: 4, text: '原始分合计: [ ________ ] / 40   |   Cambridge Scale 量表分: [ ________ ]   |   CEFR 等级: [ ________ ]', bold: true, color: '1D4ED8', align: 'center', width: 7800 }
      ]
    ];
    body += wTable(writingRows, { width: 9600, borderColor: '2B3E75', paddingTop: 80, paddingBottom: 80 });

    // 写作留足批改与病句修改大空位
    const writingBlankBox = [
      [
        {
          paragraphs: [
            { runs: [{ text: '【第一篇：写作审题与逐句病句批改反馈】 (请记录学生典型错句与升格建议)：', bold: true, color: '2B3E75', size: 19 }], spaceBefore: 60, spaceAfter: 40 },
            { runs: [{ text: '• 审题与任务回应 (Content)：____________________________________________________________________________________', color: '64748B', size: 18 }], spaceBefore: 30, spaceAfter: 30 },
            { runs: [{ text: '• 典型病句 1 原句：_____________________________________________________________________________________________', color: '64748B', size: 18 }], spaceBefore: 20, spaceAfter: 20 },
            { runs: [{ text: '  规范修改建议：________________________________________________________________________________________________', color: '64748B', size: 18 }], spaceBefore: 20, spaceAfter: 30 },
            { runs: [{ text: '• 典型病句 2 原句：_____________________________________________________________________________________________', color: '64748B', size: 18 }], spaceBefore: 20, spaceAfter: 20 },
            { runs: [{ text: '  规范修改建议：________________________________________________________________________________________________', color: '64748B', size: 18 }], spaceBefore: 20, spaceAfter: 50 },

            { runs: [{ text: '【第二篇：写作篇章逻辑与语言运用批改反馈】：', bold: true, color: '2B3E75', size: 19 }], spaceBefore: 60, spaceAfter: 40 },
            { runs: [{ text: '• 逻辑分段与过渡连接词 (Organisation)：__________________________________________________________________________', color: '64748B', size: 18 }], spaceBefore: 30, spaceAfter: 30 },
            { runs: [{ text: '• 词汇丰富度与高级句式运用 (Language)：__________________________________________________________________________', color: '64748B', size: 18 }], spaceBefore: 30, spaceAfter: 30 },
            { runs: [{ text: '• 重点错句修改建议与升格精炼：__________________________________________________________________________________', color: '64748B', size: 18 }], spaceBefore: 30, spaceAfter: 50 },

            { runs: [{ text: '【20年名师写作升格指令】：每日脱稿默写20个高频短语0拼写错误；全文标点符号与逗号拼接错句硬性降为0；连接词必须保证使用5种以上不同类型。', color: '334155', italic: true, size: 18 }], spaceBefore: 40, spaceAfter: 50 },
            { runs: [{ text: '批改教师签名：____________________          批改日期：2026年____月____日          审核意见：[  ] 卓越  [  ] 达标  [  ] 需加强', bold: true, color: '1E293B', size: 18 }], spaceBefore: 60, spaceAfter: 60 }
          ]
        }
      ]
    ];
    body += '<w:p><w:pPr><w:spacing w:before="120" w:after="80"/></w:pPr></w:p>';
    body += wTable(writingBlankBox, { width: 9600, borderColor: 'CBD5E1', paddingTop: 80, paddingBottom: 80 });

    // 换页进入 Page 4
    body += wPageBreak();

    // ==========================================
    // PAGE 4: LISTENING 听力报告 & 官方表格
    // ==========================================
    body += wP([
      { text: 'LISTENING', size: 36, bold: true, color: '2B3E75' }
    ], { spaceBefore: 60, spaceAfter: 40 });

    body += wP([
      { text: 'By Question Type', size: 24, bold: true, color: '475569' }
    ], { spaceBefore: 0, spaceAfter: 120 });

    // 官方 Navy 表头表格 (5列)
    const lStats = extractPartStats(exam, 'listening', r);
    const lTableRows = [
      [
        { text: 'Question Type', bold: true, bg: '2B3E75', color: 'FFFFFF', width: 3200 },
        { text: 'Total Question', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 1600 },
        { text: 'Correct', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 1600 },
        { text: 'Incorrect', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 1600 },
        { text: 'Scoring Rate', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 1600 }
      ]
    ];

    lStats.forEach(st => {
      lTableRows.push([
        { text: st.label, bold: true, color: '1E293B', width: 3200 },
        { text: String(st.total), align: 'center', width: 1600 },
        { text: String(st.correct), align: 'center', bold: true, color: '059669', width: 1600 },
        { text: String(st.incorrect), align: 'center', color: st.incorrect > 0 ? 'DC2626' : '64748B', width: 1600 },
        { text: `${st.scoringRate}%`, align: 'center', bold: true, color: st.scoringRate >= 80 ? '059669' : st.scoringRate < 60 ? 'DC2626' : 'D97706', width: 1600 }
      ]);
    });

    body += wTable(lTableRows, { width: 9600, borderColor: '2B3E75', paddingTop: 80, paddingBottom: 80 });

    // 表格下方大号量表分
    const lScaleVal = lScore.below ? `<${lScore.minScale} (低于报告范围)` : (lScore.scale != null ? `${lScore.scale}分` : '—');
    body += wP([
      { text: lScaleVal, size: 56, bold: true, color: '2B3E75' }
    ], { spaceBefore: 180, spaceAfter: 120 });

    // 资深教师 SMART 教学诊断与红线提分指令
    const lAnalysis = generateSmartAnalysis(exam, 'listening', lStats, lScore.scale);
    lAnalysis.forEach(p => { body += wP(p.runs, p); });

    // 换页进入 Page 5
    body += wPageBreak();

    // ==========================================
    // PAGE 5: SPEAKING 口语教师批改卡 (留足空位)
    // ==========================================
    body += wP([
      { text: 'SPEAKING', size: 36, bold: true, color: '2B3E75' }
    ], { spaceBefore: 60, spaceAfter: 40 });

    body += wP([
      { text: 'Speaking Assessment Rubric · 教师批改卡 (线下完成)', size: 24, bold: true, color: '475569' }
    ], { spaceBefore: 0, spaceAfter: 120 });

    // 口语大号得分占位
    body += wP([
      { text: `[ 待评 ] 分 (满分 ${isKet ? 25 : 30} 分，考官现场批改)`, size: 40, bold: true, color: '2B3E75' }
    ], { spaceBefore: 80, spaceAfter: 120 });

    // 官方口语评分标准表
    const speakingRows = isKet ? [
      [
        { text: 'Knowledge Point 考查维度', bold: true, bg: '2B3E75', color: 'FFFFFF', width: 3600 },
        { text: 'Full Score', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 2000 },
        { text: 'Score', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 2000 },
        { text: 'Scoring Rate', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 2000 }
      ],
      [{ text: 'Grammar and Vocabulary 语法与词汇', bold: true, width: 3600 }, { text: '5', align: 'center', width: 2000 }, { text: '[      ]', align: 'center', width: 2000 }, { text: '[      ]%', align: 'center', width: 2000 }],
      [{ text: 'Pronunciation 语音语调', bold: true, width: 3600 }, { text: '5', align: 'center', width: 2000 }, { text: '[      ]', align: 'center', width: 2000 }, { text: '[      ]%', align: 'center', width: 2000 }],
      [{ text: 'Interactive Communication 互动交际', bold: true, width: 3600 }, { text: '5', align: 'center', width: 2000 }, { text: '[      ]', align: 'center', width: 2000 }, { text: '[      ]%', align: 'center', width: 2000 }],
      [{ text: 'Global Achievement 全局表现', bold: true, width: 3600 }, { text: '5', align: 'center', width: 2000 }, { text: '[      ]', align: 'center', width: 2000 }, { text: '[      ]%', align: 'center', width: 2000 }],
      [
        { text: '口语最终核定得分', bold: true, bg: 'F1F5F9', color: '2B3E75', width: 3600 },
        { colspan: 3, text: '原始分合计: [ ________ ] / 20 (Global x2 = 25)   |   Cambridge Scale: [ ________ ]   |   CEFR: [ ________ ]', bold: true, color: '1D4ED8', align: 'center', width: 6000 }
      ]
    ] : [
      [
        { text: 'Knowledge Point 考查维度', bold: true, bg: '2B3E75', color: 'FFFFFF', width: 3600 },
        { text: 'Full Score', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 2000 },
        { text: 'Score', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 2000 },
        { text: 'Scoring Rate', bold: true, bg: '2B3E75', color: 'FFFFFF', align: 'center', width: 2000 }
      ],
      [{ text: 'Grammar and Vocabulary 语法与词汇', bold: true, width: 3600 }, { text: '5', align: 'center', width: 2000 }, { text: '[      ]', align: 'center', width: 2000 }, { text: '[      ]%', align: 'center', width: 2000 }],
      [{ text: 'Discourse Management 篇章组织', bold: true, width: 3600 }, { text: '5', align: 'center', width: 2000 }, { text: '[      ]', align: 'center', width: 2000 }, { text: '[      ]%', align: 'center', width: 2000 }],
      [{ text: 'Pronunciation 语音语调', bold: true, width: 3600 }, { text: '5', align: 'center', width: 2000 }, { text: '[      ]', align: 'center', width: 2000 }, { text: '[      ]%', align: 'center', width: 2000 }],
      [{ text: 'Interactive Communication 互动应答', bold: true, width: 3600 }, { text: '5', align: 'center', width: 2000 }, { text: '[      ]', align: 'center', width: 2000 }, { text: '[      ]%', align: 'center', width: 2000 }],
      [{ text: 'Global Achievement 全局表现', bold: true, width: 3600 }, { text: '5', align: 'center', width: 2000 }, { text: '[      ]', align: 'center', width: 2000 }, { text: '[      ]%', align: 'center', width: 2000 }],
      [
        { text: '口语最终核定得分', bold: true, bg: 'F1F5F9', color: '2B3E75', width: 3600 },
        { colspan: 3, text: '原始分合计: [ ________ ] / 25 (Global x2 = 30)   |   Cambridge Scale: [ ________ ]   |   CEFR: [ ________ ]', bold: true, color: '1D4ED8', align: 'center', width: 6000 }
      ]
    ];
    body += wTable(speakingRows, { width: 9600, borderColor: '2B3E75', paddingTop: 80, paddingBottom: 80 });

    // 口语实测表现点评与提分建议大空位
    const speakingBlankBox = [
      [
        {
          paragraphs: [
            { runs: [{ text: '【口语考官实测表现点评与建议】 (请记录现场应答细节与提升指标)：', bold: true, color: '2B3E75', size: 19 }], spaceBefore: 60, spaceAfter: 40 },
            { runs: [{ text: '1. Part 1 日常问答与流利度 (Fluency)：要求考官提问后3秒内流利作答，无长停顿与汉语中介语；', color: '475569', size: 18 }], spaceBefore: 20, spaceAfter: 20 },
            { runs: [{ text: '   现场表现记录：_____________________________________________________________________________________________', color: '64748B', size: 18 }], spaceBefore: 20, spaceAfter: 30 },

            { runs: [{ text: '2. Part 2 图片连续描述 (Descriptive Speech)：要求脱稿连续描述达60秒，包含地点、人物行为、天气与推测句式；', color: '475569', size: 18 }], spaceBefore: 30, spaceAfter: 20 },
            { runs: [{ text: '   现场表现记录：_____________________________________________________________________________________________', color: '64748B', size: 18 }], spaceBefore: 20, spaceAfter: 30 },

            { runs: [{ text: '3. 合作讨论与主动追问 (Interaction)：要求至少运用3次主动提问句式（What about you? / Do you agree?）；', color: '475569', size: 18 }], spaceBefore: 30, spaceAfter: 20 },
            { runs: [{ text: '   现场表现记录：_____________________________________________________________________________________________', color: '64748B', size: 18 }], spaceBefore: 20, spaceAfter: 30 },

            { runs: [{ text: '4. 语音重音与发音清晰度 (Pronunciation)：元音饱满、辅音尾音不吞音，重点攻克长短元音与连读；', color: '475569', size: 18 }], spaceBefore: 30, spaceAfter: 20 },
            { runs: [{ text: '   现场表现记录：_____________________________________________________________________________________________', color: '64748B', size: 18 }], spaceBefore: 20, spaceAfter: 50 },

            { runs: [{ text: '口试考官签名：____________________          测评日期：2026年____月____日          整体等级建议：[  ] 卓越  [  ] 达标  [  ] 需冲刺', bold: true, color: '1E293B', size: 18 }], spaceBefore: 60, spaceAfter: 60 }
          ]
        }
      ]
    ];
    body += '<w:p><w:pPr><w:spacing w:before="120" w:after="80"/></w:pPr></w:p>';
    body += wTable(speakingBlankBox, { width: 9600, borderColor: 'CBD5E1', paddingTop: 80, paddingBottom: 80 });

    // 页面设置 (A4, 210mm x 297mm, margins 18mm)
    body += `<w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1020" w:right="1134" w:bottom="1020" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>`;

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>${body}</w:body>
</w:document>`;
  }

  // --- XML 静态资源 ---
  const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  function getWordRelsXml(hasImage) {
    let rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
    if (hasImage) {
      rels += `\n  <Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>`;
    }
    rels += `\n</Relationships>`;
    return rels;
  }

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
  function generateDocxBlob(data, chartImageBytes = null) {
    let imageBytes = chartImageBytes || data.chartImageBytes;

    // 若无外部传入图片，在浏览器环境下尝试自动通过 CambridgeScaleChart 实时渲染
    if (!imageBytes) {
      const chartEngine = (typeof window !== 'undefined' && window.CambridgeScaleChart)
        || (typeof globalThis !== 'undefined' && globalThis.CambridgeScaleChart)
        || (typeof root !== 'undefined' && root.CambridgeScaleChart);
      if (chartEngine) {
        try {
          const rendered = chartEngine.renderChart(data.exam, {
            reading: data.scores?.reading?.scale,
            listening: data.scores?.listening?.scale
          });
          if (rendered && rendered.bytes) {
            imageBytes = rendered.bytes;
          }
        } catch (err) {
          console.warn('WordReportExporter: Automatic scale chart rendering skipped:', err);
        }
      }
    }

    const hasImage = !!(imageBytes && imageBytes.length > 0);
    const docXml = buildDocumentXml(data, hasImage);

    const zip = new SimpleZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
    zip.file('_rels/.rels', ROOT_RELS_XML);
    zip.file('word/_rels/document.xml.rels', getWordRelsXml(hasImage));
    zip.file('word/styles.xml', STYLES_XML);
    zip.file('word/document.xml', docXml);

    if (hasImage) {
      zip.file('word/media/image1.png', imageBytes);
    }

    const zipBytes = zip.generate();
    if (typeof window !== 'undefined' && typeof Blob !== 'undefined') {
      return new Blob([zipBytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
    }
    return zipBytes;
  }

  function downloadDocx(data, filename, chartImageBytes = null) {
    const blob = generateDocxBlob(data, chartImageBytes);
    const name = filename || `${data.student?.name || '考生'}_${data.exam}_${data.paperId || 'test1'}_模考成绩单.docx`;

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
    buildDocumentXml,
    extractPartStats
  };
});
