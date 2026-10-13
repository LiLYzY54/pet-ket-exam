/**
 * Cambridge English Scale Chart 官方量表图绘制引擎
 * 支持在浏览器 Canvas 中高保真绘制 KET / PET 官方量表图，自动定位分数胶囊
 * 支持导出为高清 300DPI PNG 二进制数据供 Word (.docx) 直接嵌入
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CambridgeScaleChart = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  /**
   * 绘制 Cambridge English Scale 官方量表图
   * @param {string} exam 'KET' | 'PET'
   * @param {object} scores { reading: number, listening: number, writing?: number, speaking?: number }
   * @param {object} options 自定义配置
   * @returns {{ canvas: HTMLCanvasElement, dataUrl: string, bytes: Uint8Array }}
   */
  function renderChart(exam, scores = {}, options = {}) {
    const isKet = (exam === 'KET');
    const width = options.width || 760;
    const height = options.height || 430;
    const dpr = options.dpr || 2; // 2x 视网膜高清倍率

    let canvas;
    if (typeof document !== 'undefined' && document.createElement) {
      canvas = document.createElement('canvas');
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
    } else {
      // 兼容非浏览器环境测试
      throw new Error('Canvas API requires DOM environment.');
    }

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // 1. 画布背景
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // 2. 刻度范围与坐标映射
    const minScale = isKet ? 90 : 102;
    const maxScale = isKet ? 150 : 170;
    const topY = 64;
    const botY = 388;
    const chartH = botY - topY;

    function valToY(val) {
      if (val == null || isNaN(val)) return null;
      const clamped = Math.max(minScale, Math.min(maxScale, val));
      const pct = (clamped - minScale) / (maxScale - minScale);
      return botY - pct * chartH;
    }

    // 布局基准坐标
    const cefrX = 36;
    const rulerX = 136;
    const certX = 205;
    const certW = 92;
    const colW = 86;
    const colGap = 16;
    const colsStartX = 325;

    // 3. 头部标签
    ctx.font = 'bold 12px Arial, "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#1E293B';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillText('CEFR', cefrX + 16, 22);
    ctx.fillText('Level', cefrX + 16, 38);

    ctx.fillText('Cambridge', rulerX - 10, 22);
    ctx.fillText('English Scale', rulerX - 10, 38);

    ctx.fillText('Certificated', certX + certW / 2, 22);
    ctx.fillText('Results', certX + certW / 2, 38);

    const colTitles = ['Reading', 'Writing', 'Listening', 'Speaking'];
    colTitles.forEach((name, i) => {
      const cx = colsStartX + i * (colW + colGap) + colW / 2;
      ctx.font = 'bold 14px Arial, "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#1E293B';
      ctx.fillText(name, cx, 30);
    });

    // 4. 四个技能柱状背景 (浅灰柱)
    for (let i = 0; i < 4; i++) {
      const cx = colsStartX + i * (colW + colGap);
      ctx.fillStyle = '#EDEDF0';
      ctx.fillRect(cx, topY, colW, chartH);
    }

    // 5. 等级认证色块 (Certificated Results)
    const bandsKet = [
      { min: 140, max: 150, bg: '#5A6270', text: 'Grade A', whiteText: true },
      { min: 133, max: 139, bg: '#7A8392', text: 'Grade B', whiteText: true },
      { min: 120, max: 132, bg: '#9EABB8', text: 'Grade C', whiteText: true },
      { min: 100, max: 119, bg: '#CBD5E1', text: 'Level A1', whiteText: false }
    ];

    const bandsPet = [
      { min: 160, max: 170, bg: '#5A6270', text: 'Grade A', whiteText: true },
      { min: 153, max: 159, bg: '#7A8392', text: 'Grade B', whiteText: true },
      { min: 140, max: 152, bg: '#9EABB8', text: 'Grade C', whiteText: true },
      { min: 120, max: 139, bg: '#CBD5E1', text: 'Level A2', whiteText: false }
    ];

    const bands = isKet ? bandsKet : bandsPet;
    bands.forEach(b => {
      const y1 = valToY(b.max);
      const y2 = valToY(b.min);
      ctx.fillStyle = b.bg;
      ctx.fillRect(certX, y1, certW, y2 - y1);

      ctx.fillStyle = b.whiteText ? '#FFFFFF' : '#1E293B';
      ctx.font = 'bold 12px Arial, "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.text, certX + certW / 2, (y1 + y2) / 2);
    });

    // 6. CEFR 大字标签
    const cefrKet = [
      { min: 140, max: 150, text: 'B1' },
      { min: 120, max: 139, text: 'A2' },
      { min: 100, max: 119, text: 'A1' }
    ];
    const cefrPet = [
      { min: 160, max: 170, text: 'B2' },
      { min: 140, max: 159, text: 'B1' },
      { min: 120, max: 139, text: 'A2' }
    ];
    const cefrList = isKet ? cefrKet : cefrPet;

    ctx.font = 'bold 20px Arial, "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#0F172A';
    ctx.textAlign = 'center';
    cefrList.forEach(c => {
      const cy = (valToY(c.min) + valToY(c.max)) / 2;
      ctx.fillText(c.text, cefrX + 16, cy);
    });

    // 7. 水平虚线
    const dashedVals = isKet ? [140, 130, 120, 110, 100] : [160, 150, 140, 130, 120];
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    dashedVals.forEach(v => {
      const dy = valToY(v);
      ctx.beginPath();
      ctx.moveTo(cefrX - 10, dy);
      ctx.lineTo(width - 20, dy);
      ctx.stroke();
    });
    ctx.setLineDash([]); // 恢复实线

    // 8. 刻度尺 (Ruler)
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(rulerX, topY);
    ctx.lineTo(rulerX, botY);
    ctx.stroke();

    ctx.font = '11px Arial, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#0F172A';

    for (let sv = minScale; sv <= maxScale; sv++) {
      const sy = valToY(sv);
      if (sv % 10 === 0) {
        ctx.beginPath();
        ctx.moveTo(rulerX - 8, sy);
        ctx.lineTo(rulerX, sy);
        ctx.stroke();
        ctx.fillText(String(sv), rulerX - 12, sy + 3);
      } else if (sv % 5 === 0) {
        ctx.beginPath();
        ctx.moveTo(rulerX - 5, sy);
        ctx.lineTo(rulerX, sy);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(rulerX - 3, sy);
        ctx.lineTo(rulerX, sy);
        ctx.stroke();
      }
    }

    // 9. 自动绘制分数胶囊 (Score Pills)
    const pillW = 66;
    const pillH = 26;
    const pillRadius = 13;

    function drawPill(x, y, text, isOffline = false) {
      ctx.save();
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, pillW, pillH, pillRadius);
      } else {
        // Fallback for older roundRect
        ctx.arc(x + pillRadius, y + pillRadius, pillRadius, Math.PI, 1.5 * Math.PI);
        ctx.arc(x + pillW - pillRadius, y + pillRadius, pillRadius, 1.5 * Math.PI, 2 * Math.PI);
        ctx.arc(x + pillW - pillRadius, y + pillH - pillRadius, pillRadius, 0, 0.5 * Math.PI);
        ctx.arc(x + pillRadius, y + pillH - pillRadius, pillRadius, 0.5 * Math.PI, Math.PI);
        ctx.closePath();
      }

      if (isOffline) {
        ctx.fillStyle = '#F8FAFC';
        ctx.fill();
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#64748B';
        ctx.font = '12px Arial, "Microsoft YaHei", sans-serif';
      } else {
        ctx.fillStyle = '#2B3E75'; // 官方深蓝色胶囊
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 14px Arial, "Microsoft YaHei", sans-serif';
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + pillW / 2, y + pillH / 2);
      ctx.restore();
    }

    // 四科目顺序：Reading, Writing, Listening, Speaking
    const skillKeys = ['reading', 'writing', 'listening', 'speaking'];
    skillKeys.forEach((key, idx) => {
      const cx = colsStartX + idx * (colW + colGap);
      const px = cx + (colW - pillW) / 2;
      const scoreVal = scores[key];

      if (scoreVal != null && !isNaN(scoreVal) && scoreVal >= minScale) {
        const py = valToY(scoreVal) - pillH / 2;
        drawPill(px, py, String(scoreVal), false);
      } else if (key === 'writing' || key === 'speaking') {
        // 写作与口语线下批改，若无分数则在中段绘制待评小卡
        const midScore = isKet ? 120 : 140;
        const py = valToY(midScore) - pillH / 2;
        drawPill(px, py, '待评', true);
      }
    });

    // 10. 生成数据
    const dataUrl = canvas.toDataURL('image/png');
    
    // 将 dataUrl 转换为 Uint8Array 供 Word 嵌入
    let bytes = null;
    try {
      const base64 = dataUrl.split(',')[1];
      const binaryStr = typeof atob !== 'undefined' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
      bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
    } catch (e) {
      console.warn('Failed to convert canvas to Uint8Array:', e);
    }

    return {
      canvas,
      dataUrl,
      bytes
    };
  }

  return {
    renderChart
  };
});
