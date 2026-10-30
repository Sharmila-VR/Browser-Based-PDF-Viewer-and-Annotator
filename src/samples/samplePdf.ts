export function createSamplePdf(pageCount = 3): Uint8Array {
  const encoder = new TextEncoder();
  const objects: string[] = [];

  const catalogObjNum = 1;
  const pagesObjNum = 2;
  const outlinesObjNum = 3;
  const fontObjNum = 4;
  const fontBoldObjNum = 5;

  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];

  let nextObjNum = 6;
  for (let i = 0; i < pageCount; i++) {
    pageObjNums.push(nextObjNum++);
    contentObjNums.push(nextObjNum++);
  }

  // 1: Catalog
  objects[catalogObjNum] = `<<
  /Type /Catalog
  /Pages ${pagesObjNum} 0 R
  /Outlines ${outlinesObjNum} 0 R
>>`;

  // 2: Pages
  const kidsStr = pageObjNums.map((num) => `${num} 0 R`).join(' ');
  objects[pagesObjNum] = `<<
  /Type /Pages
  /Kids [ ${kidsStr} ]
  /Count ${pageCount}
  /MediaBox [ 0 0 612 792 ]
>>`;

  // 3: Outlines
  const firstOutlineObj = nextObjNum++;
  objects[outlinesObjNum] = `<<
  /Type /Outlines
  /First ${firstOutlineObj} 0 R
  /Count ${Math.min(pageCount, 3)}
>>`;

  // Font 1: Helvetica
  objects[fontObjNum] = `<<
  /Type /Font
  /Subtype /Type1
  /BaseFont /Helvetica
  /Encoding /WinAnsiEncoding
>>`;

  // Font 2: Helvetica-Bold
  objects[fontBoldObjNum] = `<<
  /Type /Font
  /Subtype /Type1
  /BaseFont /Helvetica-Bold
  /Encoding /WinAnsiEncoding
>>`;

  // Page definitions and content streams
  for (let i = 0; i < pageCount; i++) {
    const pNum = pageObjNums[i];
    const cNum = contentObjNums[i];

    objects[pNum] = `<<
  /Type /Page
  /Parent ${pagesObjNum} 0 R
  /MediaBox [ 0 0 612 792 ]
  /Contents ${cNum} 0 R
  /Resources <<
    /Font <<
      /F1 ${fontObjNum} 0 R
      /F2 ${fontBoldObjNum} 0 R
    >>
  >>
>>`;

    let stream = '';
    if (i === 0) {
      stream = `
q
0.95 0.96 0.98 rg
0 0 612 792 re
f
0.1 0.35 0.8 rg
40 710 532 50 re
f
0.2 0.5 0.9 RG
2 w
40 710 532 50 re
s
Q
BT
/F2 22 Tf
1 1 1 rg
60 728 Td
(Client-Side PDF Engine & Annotator) Tj
ET
BT
/F1 12 Tf
0.2 0.2 0.2 rg
60 660 Td
(This PDF document was processed and rendered entirely client-side without any third-party) Tj
0 -20 Td
(libraries using modern web standards: Canvas 2D, DecompressionStream, and Web Workers.) Tj
0 -30 Td
(Core System Capabilities:) Tj
0 -20 Td
(- Full PDF Lexer & Object Parser with XRef streams and object streams support) Tj
0 -18 Td
(- Graceful XRef reconstruction for damaged or incomplete PDF files) Tj
0 -18 Td
(- High-precision text layout extraction and invisible DOM selection layer) Tj
0 -18 Td
(- Incremental updates: save highlights, notes, rectangles and ink back into the PDF) Tj
0 -18 Td
(- Responsive 60fps virtualized rendering with multi-level zoom and thumbnail sidebar) Tj
ET
q
0.15 0.65 0.35 rg
60 410 240 60 re
f
0.85 0.25 0.2 rg
330 410 240 60 re
f
Q
BT
/F2 14 Tf
1 1 1 rg
80 435 Td
(Vector Graphics Support) Tj
ET
BT
/F2 14 Tf
1 1 1 rg
350 435 Td
(Native Annotations Ready) Tj
ET
BT
/F1 11 Tf
0.3 0.3 0.3 rg
60 360 Td
(Try selecting any text above, drawing ink annotations, creating notes, or searching for keywords.) Tj
0 -18 Td
(When finished, click 'Save PDF' to export standard incremental PDF annotation objects.) Tj
0 -30 Td
(Page 1 of ${pageCount}) Tj
ET
`;
    } else {
      stream = `
q
0.98 0.98 0.99 rg
0 0 612 792 re
f
0.2 0.4 0.7 rg
40 730 532 30 re
f
Q
BT
/F2 16 Tf
1 1 1 rg
60 740 Td
(Document Section: Page ${i + 1}) Tj
ET
BT
/F1 12 Tf
0.2 0.2 0.2 rg
60 690 Td
(Content verification page #${i + 1} for high-performance virtualized scrolling.) Tj
0 -25 Td
(The viewer keeps memory usage low by unloading offscreen pages from active canvas memory.) Tj
0 -25 Td
(All annotations created on this page will persist across zoom changes and page rotations.) Tj
0 -40 Td
(Search keyword test: "benchmark", "performance", "client-side", "annotations".) Tj
0 -60 Td
(Page ${i + 1} of ${pageCount}) Tj
ET
`;
    }

    const streamBytes = encoder.encode(stream.trim());
    objects[cNum] = `<<
  /Length ${streamBytes.length}
>>
stream
${stream.trim()}
endstream`;
  }

  // Outline item
  objects[firstOutlineObj] = `<<
  /Title (Chapter 1: Overview)
  /Dest [ ${pageObjNums[0]} 0 R /XYZ null null null ]
>>`;

  let pdfText = '%PDF-1.7\n%\xFF\xFF\xFF\xFF\n';
  const offsets: number[] = [0];

  for (let i = 1; i < objects.length; i++) {
    if (!objects[i]) continue;
    offsets[i] = encoder.encode(pdfText).length;
    pdfText += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const startXRef = encoder.encode(pdfText).length;
  pdfText += 'xref\n';
  pdfText += `0 ${objects.length}\n`;
  pdfText += '0000000000 65535 f \n';

  for (let i = 1; i < objects.length; i++) {
    const off = offsets[i] || 0;
    const pad = String(off).padStart(10, '0');
    pdfText += `${pad} 00000 n \n`;
  }

  pdfText += 'trailer\n<<\n';
  pdfText += `  /Size ${objects.length}\n`;
  pdfText += `  /Root ${catalogObjNum} 0 R\n`;
  pdfText += '>>\n';
  pdfText += 'startxref\n';
  pdfText += `${startXRef}\n`;
  pdfText += '%%EOF\n';

  return encoder.encode(pdfText);
}

export function createCorruptedSamplePdf(): Uint8Array {
  const valid = createSamplePdf(2);
  const text = new TextDecoder('latin1').decode(valid);
  // Corrupt startxref number and xref header
  const corrupted = text
    .replace('startxref\n', 'startxref\n9999999\n%')
    .replace('xref\n0 ', 'broken_xref\n0 ');
  return new TextEncoder().encode(corrupted);
}

export function createBenchmarkPdf(pageCount = 200): Uint8Array {
  return createSamplePdf(pageCount);
}
