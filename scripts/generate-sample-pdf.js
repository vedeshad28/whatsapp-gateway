// One-off generator for public/sample-invoice.pdf — a minimal valid PDF
// used only as the header-example sample Meta needs to approve the
// auto-created "invoice_ready" document-header template. Not run at
// request time; the output is committed and served as a static asset.
const fs = require('node:fs');
const path = require('node:path');

function buildPdf() {
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  const streamText = 'BT /F1 14 Tf 20 150 Td (Sample Invoice) Tj ET';
  objects[5] = `<< /Length ${streamText.length} >>\nstream\n${streamText}\nendstream`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

const outPath = path.join(__dirname, '..', 'public', 'sample-invoice.pdf');
fs.writeFileSync(outPath, buildPdf());
console.log('Wrote', outPath);
