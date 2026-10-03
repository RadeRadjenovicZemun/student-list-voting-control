const fs = require('fs');
const PDFDocument = require('pdfkit');

const FONT_CANDIDATES = [
  process.env.DOK_PDF_FONT,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  'C:/Windows/Fonts/arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf'
].filter(Boolean);
const BOLD_FONT_CANDIDATES = [
  process.env.DOK_PDF_BOLD_FONT,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
  'C:/Windows/Fonts/arialbd.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/Library/Fonts/Arial Bold.ttf'
].filter(Boolean);

const TURNOUT_COLUMNS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
const TURNOUT_FOOTER_RESERVED_HEIGHT = 24;
const SIGNATURE_BLOCK_RESERVED_HEIGHT = 92;

function resolveFontPath() {
  const fontPath = FONT_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!fontPath) {
    throw new Error('No Cyrillic-capable PDF font found; set DOK_PDF_FONT to a TTF font path.');
  }
  return fontPath;
}

function resolveBoldFontPath() {
  return BOLD_FONT_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || resolveFontPath();
}

function drawNoteWithBoldPrefix(doc, text, x, y, width, fontSize, lineGap = 2) {
  const prefixEnd = text.indexOf(':') + 1;
  const prefix = text.slice(0, prefixEnd + 1);
  const body = text.slice(prefix.length);

  doc.font(resolveBoldFontPath()).fontSize(fontSize).text(prefix, x, y, {
    width,
    continued: true,
    underline: true,
    lineGap
  });
  doc.font(resolveFontPath()).fontSize(fontSize).text(body, {
    width,
    lineGap,
    underline: false
  });
  return doc.y - y;
}

function asText(value, fallback = '') {
  const normalized = String(value == null ? '' : value).trim();
  return normalized || fallback;
}

function makePdfDocument(layout = 'portrait') {
  const doc = new PDFDocument({
    size: 'A4',
    layout,
    margins: { top: 28, right: 34, bottom: 30, left: 34 },
    bufferPages: true
  });
  doc.font(resolveFontPath()).fontSize(10).fillColor('#17212b');
  return doc;
}

function collectPdf(doc, finalize = null) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      if (finalize) finalize(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function getElectionDate(config) {
  return asText(config && (config.electionDate || config.date)) || '____________________';
}

function getRegisteredVotersLabel(context) {
  const registeredVoters = Math.max(0, Math.floor(Number(context.place && context.place.registeredVoters) || 0));
  return `Број уписаних бирача: ${registeredVoters.toLocaleString('sr-RS')}`;
}

function drawDocumentHeader(doc, context, documentLabel, declarationText = null, leadingLabel = null) {
  const { config = {} } = context;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const electionName = asText(
    config.multiLanguage && config.multiLanguage.sr && config.multiLanguage.sr.title,
    asText(config.name, 'Избори')
  );

  doc.fontSize(16).font(resolveFontPath()).text(electionName, { width, align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(12).text(`Датум избора: ${getElectionDate(config)}`, { width, align: 'center' });
  doc.moveDown(0.6);

  if (leadingLabel) {
    doc.font(resolveFontPath()).fontSize(12).text(leadingLabel, { width, align: 'left', underline: true });
    doc.moveDown(0.3);
  }

  if (declarationText) {
    doc.moveDown(0.15);
    doc.fontSize(11).text(declarationText, {
      width,
      lineGap: 2
    });
  }
  doc.moveDown(0.15);
  doc.fontSize(11).text(`Регион: ${asText(context.regionName, '____________________')}`, { width });
  doc.moveDown(0.15);
  doc.fontSize(11).text(`Општина: ${asText(context.municipalityName, '____________________')}`, { width });
  doc.text(`Бирачко место: ${asText(context.placeName, '____________________')}`, { width });
  doc.text(getRegisteredVotersLabel(context), { width });
  if (documentLabel) {
    doc.moveDown(0.5);
    doc.fontSize(11).text(documentLabel, { width, align: 'center' });
    doc.moveDown(0.55);
  }
  doc.fontSize(9);
}

function drawDocumentSignatureBlock(doc, context, options = {}) {
  const footerSafeBottom = doc.page.height - doc.page.margins.bottom - TURNOUT_FOOTER_RESERVED_HEIGHT;
  if (options.startY == null && doc.y + SIGNATURE_BLOCK_RESERVED_HEIGHT > footerSafeBottom) {
    doc.addPage();
    drawTurnoutContinuationHeader(doc, context);
  }

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const rightInset = 12;
  const lineWidth = width / 3;
  const lineLeft = doc.page.margins.left + width - rightInset - lineWidth;
  const nameLabel = 'Име и презиме:';
  const nameLabelWidth = doc.font(resolveFontPath()).fontSize(11).widthOfString(nameLabel);
  const labelGap = 8;
  if (options.startY == null) {
    doc.moveDown(2);
  } else {
    doc.y = options.startY;
  }
  const nameY = doc.y;
  const nameLabelX = lineLeft - labelGap - nameLabelWidth;
  doc.font(resolveFontPath()).fontSize(11).text(nameLabel, nameLabelX, nameY, {
    width: nameLabelWidth,
    align: 'left',
    lineBreak: false
  });
  const nameRuleY = nameY + 13;
  const signatureRuleY = nameY + 48;
  doc.save().lineWidth(0.55).strokeColor('#334155');
  doc.moveTo(lineLeft, nameRuleY).lineTo(lineLeft + lineWidth, nameRuleY).stroke();
  for (let dashX = lineLeft; dashX < lineLeft + lineWidth; dashX += 10) {
    doc.moveTo(dashX, signatureRuleY).lineTo(Math.min(dashX + 5, lineLeft + lineWidth), signatureRuleY).stroke();
  }
  doc.restore();
  doc.font(resolveFontPath()).fontSize(11).text('с.р.', lineLeft, signatureRuleY + 4, {
    width: lineWidth,
    align: 'center'
  });
  doc.y = signatureRuleY + 18;
}

function drawTurnoutCountFields(doc, context) {
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const frameY = doc.y + 14;
  const frameHeight = 170;
  const boxWidth = 68;
  const boxHeight = 22;
  const boxX = x + width * 0.52;
  const labelX = x + 8;
  const labelWidth = boxX - labelX - 8;
  const firstRowY = frameY + 29;
  const secondRowY = frameY + 56;
  const signatureStartY = frameY + 94;
  const frameNote = 'Коначне бројеве уписати након пребројавања гласова.';
  const noteX = x + 8;
  const noteWidth = doc.font(resolveFontPath()).fontSize(10).widthOfString(frameNote);
  const topGapStart = noteX - 3;
  const topGapEnd = noteX + noteWidth + 5;

  doc.save().lineWidth(0.8).strokeColor('#64748b');
  doc.moveTo(x, frameY).lineTo(topGapStart, frameY).stroke();
  doc.moveTo(topGapEnd, frameY).lineTo(x + width, frameY).stroke();
  doc.moveTo(x, frameY).lineTo(x, frameY + frameHeight).stroke();
  doc.moveTo(x + width, frameY).lineTo(x + width, frameY + frameHeight).stroke();
  doc.moveTo(x, frameY + frameHeight).lineTo(x + width, frameY + frameHeight).stroke();
  doc.restore();

  doc.save().fillColor('#ffffff').rect(topGapStart, frameY - 6, topGapEnd - topGapStart, 13).fill().restore();
  doc.font(resolveFontPath()).fontSize(10).fillColor('#17212b').text(frameNote, noteX, frameY - 6, {
    width: width - 16,
    lineBreak: false
  });
  doc.text('Број бирача који су гласали на бирачком месту:', labelX, firstRowY + 6, {
    width: labelWidth,
    align: 'left',
    lineBreak: false
  });
  doc.text('Број бирача који су гласали од куће:', labelX, secondRowY + 6, {
    width: labelWidth,
    align: 'left',
    lineBreak: false
  });
  doc.save().lineWidth(0.8).strokeColor('#334155');
  doc.rect(boxX, firstRowY, boxWidth, boxHeight).stroke();
  doc.rect(boxX, secondRowY, boxWidth, boxHeight).stroke();
  doc.restore();
  drawDocumentSignatureBlock(doc, context, { startY: signatureStartY });
  doc.y = frameY + frameHeight;
  doc.moveDown(0.9);
}

function drawPreliminaryResultsFrame(doc, context, candidates) {
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const frameNote = 'Коначне бројеве уписати након валидације пребројаних гласова.';
  const noteX = x + 8;
  const noteWidth = doc.font(resolveFontPath()).fontSize(10).widthOfString(frameNote);
  const topGapStart = noteX - 3;
  const topGapEnd = noteX + noteWidth + 5;
  const columnCount = 10;
  const cellWidth = width / columnCount;
  const boxWidth = Math.min(38, cellWidth - 8);
  const boxHeight = 18;
  const rowHeight = 34;
  const rows = [
    ...candidates.map((candidate, index) => ({
      label: `${asText(candidate && candidate.id, String(index + 1))}.`,
      fontSize: 9
    })),
    { label: 'Неважећи', fontSize: 7 },
    { label: 'Преостали', fontSize: 7 }
  ];
  const rowsStartOffset = 20;
  const signatureOffset = 94;
  const frameHeight = signatureOffset + 68;
  let frameY = doc.y + 14;
  const footerSafeBottom = doc.page.height - doc.page.margins.bottom - TURNOUT_FOOTER_RESERVED_HEIGHT;

  if (frameY + frameHeight > footerSafeBottom) {
    doc.addPage();
    drawTurnoutContinuationHeader(doc, context);
    frameY = doc.y + 14;
  }

  doc.save().lineWidth(0.8).strokeColor('#64748b');
  doc.moveTo(x, frameY).lineTo(topGapStart, frameY).stroke();
  doc.moveTo(topGapEnd, frameY).lineTo(x + width, frameY).stroke();
  doc.moveTo(x, frameY).lineTo(x, frameY + frameHeight).stroke();
  doc.moveTo(x + width, frameY).lineTo(x + width, frameY + frameHeight).stroke();
  doc.moveTo(x, frameY + frameHeight).lineTo(x + width, frameY + frameHeight).stroke();
  doc.restore();

  doc.save().fillColor('#ffffff').rect(topGapStart, frameY - 6, topGapEnd - topGapStart, 13).fill().restore();
  doc.font(resolveFontPath()).fontSize(10).fillColor('#17212b').text(frameNote, noteX, frameY - 6, {
    width: width - 16,
    lineBreak: false
  });

  rows.forEach((row, index) => {
    const gridRow = Math.floor(index / columnCount);
    const gridColumn = index % columnCount;
    const cellX = x + gridColumn * cellWidth;
    const rowTop = frameY + rowsStartOffset + gridRow * rowHeight;
    const labelY = rowTop;
    const labelWidth = cellWidth - 4;
    const labelHeight = doc.font(resolveFontPath()).fontSize(row.fontSize).heightOfString(row.label, {
      width: labelWidth,
      align: 'center',
      lineBreak: false
    });
    doc.font(resolveFontPath()).fontSize(row.fontSize).text(row.label, cellX + 2, labelY, {
      width: labelWidth,
      align: 'center',
      lineBreak: false
    });
    const boxX = cellX + (cellWidth - boxWidth) / 2;
    doc.save().lineWidth(0.8).strokeColor('#334155')
      .rect(boxX, rowTop + 11 + Math.max(0, (14 - labelHeight) / 2), boxWidth, boxHeight)
      .stroke()
      .restore();
  });

  drawDocumentSignatureBlock(doc, context, { startY: frameY + signatureOffset });
  doc.y = frameY + frameHeight;
  doc.moveDown(0.9);
}

function drawTurnoutContinuationHeader(doc, context) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const headerY = doc.page.margins.top;
  doc.font(resolveFontPath()).fontSize(10).text(
    `Бирачко место: ${asText(context.placeName, '____________________')}`,
    doc.page.margins.left,
    headerY,
    { width, align: 'left' }
  );
  doc.text(getRegisteredVotersLabel(context), doc.page.margins.left, headerY + 12, {
    width,
    align: 'left'
  });
  doc.y = headerY + 26;
}

function drawTurnoutPageFooters(doc) {
  const pageRange = doc.bufferedPageRange();
  const pageCount = pageRange.count;

  for (let pageIndex = pageRange.start; pageIndex < pageRange.start + pageCount; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const page = doc.page;
    const left = page.margins.left;
    const right = page.width - page.margins.right;
    const footerY = page.height - page.margins.bottom - 20;
    doc.save().lineWidth(0.45).strokeColor('#9aa8b5');
    doc.moveTo(left, footerY - 4).lineTo(right, footerY - 4).stroke();
    doc.font(resolveFontPath()).fontSize(11).fillColor('#334155');
    doc.text('Студентска листа - студенти побеђују', left, footerY, {
      width: (right - left) * 0.7,
      align: 'left',
      lineBreak: false
    });
    doc.fontSize(11);
    doc.text(`${pageIndex - pageRange.start + 1}/${pageCount}`, left, footerY, {
      width: right - left,
      align: 'right',
      lineBreak: false
    });
    doc.restore();
  }
}

function drawTurnoutTableHeader(doc, x, y, firstColumnWidth, dataColumnWidth, rowHeight) {
  const headers = ['', ...TURNOUT_COLUMNS.map(String)];
  let columnX = x;
  doc.save().lineWidth(0.6).strokeColor('#64748b').fillColor('#ffffff');
  headers.forEach((label, index) => {
    const cellWidth = index === 0 ? firstColumnWidth : dataColumnWidth;
    doc.fillColor('#ffffff');
    doc.rect(columnX, y, cellWidth, rowHeight).fillAndStroke();
    if (label) {
      doc.fillColor('#17212b').fontSize(11).text(label, columnX + 2, y + 5, {
        width: cellWidth - 4,
        align: 'center',
        lineBreak: false
      });
    }
    columnX += cellWidth;
  });
  doc.restore();
}

function createTurnoutPdf(context) {
  const registeredVoters = Math.max(0, Math.floor(Number(context.place && context.place.registeredVoters) || 0));
  const doc = makePdfDocument('portrait');
  drawDocumentHeader(
    doc,
    context,
    null,
    'Изјављујем да сам излазност на бирачком месту пратио/ла лично и да је табела попуњена према уоченом стању. Приказани бројеви су прелиминарни.',
    'Табела за праћење излазности'
  );
  drawTurnoutCountFields(doc, context);

  const pageLeft = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const firstColumnWidth = 48;
  const dataColumnWidth = (pageWidth - firstColumnWidth) / TURNOUT_COLUMNS.length;
  const rowHeight = 28.5;
  const tableHeaderHeight = 22;
  const tableInstruction = 'Напомена: Празна поља попуњавати слева надесно, одозго надоле. За сваких пет изашлих бирача у пољу уписати четири усправне црте, а пету повући укосо преко њих.';
  const instructionHeight = doc.font(resolveFontPath()).fontSize(11).heightOfString(tableInstruction, {
    width: pageWidth,
    lineGap: 2
  }) + 4;
  const tableSpacing = 6;
  const tableSafeBottom = doc.page.height - doc.page.margins.bottom - TURNOUT_FOOTER_RESERVED_HEIGHT;

  if (doc.y + instructionHeight + tableSpacing + tableHeaderHeight + rowHeight > tableSafeBottom) {
    doc.addPage();
    drawTurnoutContinuationHeader(doc, context);
  }

  const instructionY = doc.y;
  const actualInstructionHeight = drawNoteWithBoldPrefix(doc, tableInstruction, pageLeft, instructionY, pageWidth, 11);
  doc.y = instructionY + Math.max(instructionHeight - 4, actualInstructionHeight) + tableSpacing;
  let tableTop = doc.y;

  const drawTurnoutTableLabel = () => {
    doc.moveDown(0.7);
    doc.font(resolveFontPath()).fontSize(12).text('Табела за праћење излазности', {
      width: pageWidth,
      align: 'center'
    });
    doc.moveDown(0.35);
    tableTop = doc.y;
  };

  const drawPageTableHeader = () => {
    drawTurnoutTableHeader(doc, pageLeft, tableTop, firstColumnWidth, dataColumnWidth, tableHeaderHeight);
    tableTop += tableHeaderHeight;
  };
  drawPageTableHeader();

  const rowCount = Math.max(1, Math.ceil(registeredVoters / 50) + 1);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    if (tableTop + rowHeight > doc.page.height - doc.page.margins.bottom - TURNOUT_FOOTER_RESERVED_HEIGHT) {
      doc.addPage();
      drawTurnoutContinuationHeader(doc, context);
      doc.moveDown(0.7);
      tableTop = doc.y;
      drawPageTableHeader();
    }

    const y = tableTop;
    let x = pageLeft;
    doc.save().lineWidth(0.45).strokeColor('#9aa8b5').fillColor('#ffffff');
    for (let columnIndex = 0; columnIndex <= TURNOUT_COLUMNS.length; columnIndex += 1) {
      const cellWidth = columnIndex === 0 ? firstColumnWidth : dataColumnWidth;
      doc.fillColor('#ffffff');
      doc.rect(x, y, cellWidth, rowHeight).fillAndStroke();
      if (columnIndex === 0) {
        doc.fillColor('#17212b').fontSize(11).text(String(rowIndex * 50), x + 2, y + (rowHeight - 13) / 2, {
          width: cellWidth - 4,
          align: 'center',
          lineBreak: false
        });
      }
      x += cellWidth;
    }
    doc.restore();
    tableTop += rowHeight;
  }

  return collectPdf(doc, drawTurnoutPageFooters);
}

function getCandidates(config) {
  const rootCandidates = config && config.result && config.result.candidateVotes;
  if (Array.isArray(rootCandidates) && rootCandidates.length) return rootCandidates;

  for (const region of Array.isArray(config && config.regions) ? config.regions : []) {
    for (const municipality of region.municipalities || []) {
      for (const place of municipality.places || []) {
        const candidates = place.result && place.result.candidateVotes;
        if (Array.isArray(candidates) && candidates.length) return candidates;
      }
    }
  }
  return [];
}

function drawCandidatePageHeader(doc, context, continuation = false) {
  if (continuation) {
    drawTurnoutContinuationHeader(doc, context);
  } else {
    drawDocumentHeader(
      doc,
      context,
      null,
      'Изјављујем да сам бројање гласова на бирачком месту пратио/ла лично и да су резултати унети према утврђеном стању. Приказани бројеви су прелиминарни.',
      'Листа за унос прелиминарних резултата'
    );
  }
  doc.moveDown(0.35);
}

async function createPreliminaryResultsPdf(context) {
  const doc = makePdfDocument('portrait');
  const candidates = getCandidates(context.config || {});
  const pageLeft = doc.page.margins.left;
  const pageRight = doc.page.width - doc.page.margins.right;
  const boxHeight = 50;
  const textX = pageLeft;
  const textWidth = pageRight - pageLeft;
  const boxWidth = textWidth;

  drawCandidatePageHeader(doc, context);
  const candidateList = candidates.length
    ? candidates
    : [{ id: '', name: 'Листа кандидата није доступна у конфигурацији.' }];
  drawPreliminaryResultsFrame(doc, context, candidateList);
  const summaryLabels = ['Неважећи', 'Преостали'];
  const summaryTextHeights = summaryLabels.map((label) => {
    doc.font(resolveFontPath()).fontSize(9);
    return doc.heightOfString(label, { width: textWidth, align: 'left' });
  });
  const summaryRowGap = 3;
  const summaryBlockHeight = summaryLabels.reduce((height, _label, index) => {
    return height + summaryTextHeights[index] + 4 + boxHeight + 8;
  }, summaryRowGap);
  const candidateListNote = 'Напомена: Поља у наставку могу се користити за уписивање привремених резултата и исправки насталих услед поновљеног пребројавања због кршења правила за валидацију бројања гласова.';
  const candidateListNoteFontSize = 11;

  for (let index = 0; index < candidateList.length; index += 1) {
    const candidate = candidateList[index] || {};
    const candidateName = asText(candidate.name, `Кандидат ${asText(candidate.id, String(index + 1))}`);
    const prefix = candidate.id && !candidateName.startsWith(`${candidate.id}.`)
      ? `${candidate.id}. `
      : '';
    const label = `${prefix}${candidateName}`;
    doc.font(resolveFontPath()).fontSize(9);
    const textHeight = doc.heightOfString(label, { width: textWidth, align: 'left', lineGap: 2 });
    const boxGap = 4;
    const rowHeight = textHeight + boxGap + boxHeight + 8;
    const reservedHeight = TURNOUT_FOOTER_RESERVED_HEIGHT;
    const noteHeight = index === 0
      ? doc.font(resolveFontPath()).fontSize(candidateListNoteFontSize)
        .heightOfString(candidateListNote, { width: textWidth, lineGap: 2 }) + 10
      : 0;
    const finalCandidateSummaryHeight = index === candidateList.length - 1 ? summaryBlockHeight : 0;

    if (doc.y + noteHeight + rowHeight + finalCandidateSummaryHeight > doc.page.height - doc.page.margins.bottom - reservedHeight) {
      doc.addPage();
      drawCandidatePageHeader(doc, context, true);
    }

    if (index === 0) {
      const noteY = doc.y;
      const actualNoteHeight = drawNoteWithBoldPrefix(doc, candidateListNote, textX, noteY, textWidth, candidateListNoteFontSize);
      doc.y = noteY + Math.max(noteHeight - 10, actualNoteHeight) + 6;
    }

    const rowTop = doc.y;
    doc.font(resolveFontPath()).fontSize(9).text(label, textX, rowTop, {
      width: textWidth,
      align: 'left',
      lineGap: 2
    });
    const boxY = rowTop + textHeight + boxGap;
    doc.save().lineWidth(0.8).strokeColor('#334155').rect(pageLeft, boxY, boxWidth, boxHeight).stroke().restore();
    doc.y = rowTop + rowHeight;
    doc.moveDown(0.25);
  }

  const footerSafeBottom = doc.page.height - doc.page.margins.bottom - TURNOUT_FOOTER_RESERVED_HEIGHT;
  if (doc.y + summaryBlockHeight > footerSafeBottom) {
    doc.addPage();
    drawCandidatePageHeader(doc, context, true);
  }

  for (let index = 0; index < summaryLabels.length; index += 1) {
    const label = summaryLabels[index];
    const textHeight = summaryTextHeights[index];
    const boxGap = 4;
    const rowHeight = textHeight + boxGap + boxHeight + 8;

    const rowTop = doc.y;
    doc.font(resolveFontPath()).fontSize(9).text(label, textX, rowTop, {
      width: textWidth,
      align: 'left',
      lineBreak: false
    });
    const boxY = rowTop + textHeight + boxGap;
    doc.save().lineWidth(0.8).strokeColor('#334155').rect(pageLeft, boxY, boxWidth, boxHeight).stroke().restore();
    doc.y = rowTop + rowHeight;
    if (index < summaryLabels.length - 1) doc.moveDown(0.25);
  }

  return collectPdf(doc, drawTurnoutPageFooters);
}

module.exports = {
  TURNOUT_COLUMNS,
  createTurnoutPdf,
  createPreliminaryResultsPdf,
  getCandidates
};