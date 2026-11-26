/* Petit générateur de fichiers Excel (.xlsx) sans dépendance. */
'use strict';
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(fichiers) {
  const locaux = [], central = [];
  let offset = 0;
  for (const f of fichiers) {
    const nom = Buffer.from(f.nom, 'utf8');
    const brut = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(brut);
    const crc = crc32(brut);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(brut.length, 22);
    h.writeUInt16LE(nom.length, 26); h.writeUInt16LE(0, 28);
    locaux.push(h, nom, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(brut.length, 24);
    c.writeUInt16LE(nom.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nom);
    offset += 30 + nom.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(fichiers.length, 8); fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locaux, cd, fin]);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function colLettre(i) {
  let s = ''; i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

function serieDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

/* Styles : 0 normal, 1 en-tête, 2 montant, 3 date, 4 total texte, 5 total montant, 6 titre, 7 gras, 8-10 surligné N-1 (texte, montant, date) */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;;[Red]\\-#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F5D50"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EFEC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * feuille = { nom, colonnes: [largeurs], lignes: [[cellule]], figer: nbLignesFigees, filtre: true }
 * cellule = valeur simple, ou { v, t: 'n'|'s'|'d'|'f', s: style }
 */
function feuilleXml(f) {
  const lignes = f.lignes.map((ligne, r) => {
    const cells = ligne.map((cell, c) => {
      if (cell == null || cell === '') return '';
      let o = (typeof cell === 'object') ? cell : { v: cell };
      if (o.v == null || o.v === '') { if (o.s) return `<c r="${colLettre(c)}${r + 1}" s="${o.s}"/>`; return ''; }
      const ref = colLettre(c) + (r + 1);
      const s = o.s ? ` s="${o.s}"` : '';
      const t = o.t || (typeof o.v === 'number' ? 'n' : 's');
      if (t === 'f') return `<c r="${ref}"${s}><f>${esc(o.v)}</f></c>`;
      if (t === 'd') return `<c r="${ref}" s="${o.s || 3}"><v>${serieDate(o.v)}</v></c>`;
      if (t === 'n') return `<c r="${ref}"${s}><v>${o.v}</v></c>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  const cols = (f.colonnes || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const figer = f.figer ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${f.figer}" topLeftCell="A${f.figer + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
  const nbCols = Math.max(1, ...f.lignes.map(l => l.length));
  const filtre = f.filtre && f.lignes.length > 1 ? `<autoFilter ref="A${f.filtreLigne || 1}:${colLettre(nbCols - 1)}${f.lignes.length}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${figer}${cols ? '<cols>' + cols + '</cols>' : ''}<sheetData>${lignes}</sheetData>${filtre}</worksheet>`;
}

function classeur(feuilles) {
  const noms = feuilles.map(f => String(f.nom).replace(/[\\\/\?\*\[\]:]/g, '-').slice(0, 31));
  const fichiers = [
    { nom: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${feuilles.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { nom: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nom: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${noms.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${feuilles.some(f => f.filtre) ? '<definedNames>' + feuilles.map((f, i) => f.filtre && f.lignes.length > 1 ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(noms[i])}'!$A$${f.filtreLigne || 1}:$${colLettre(Math.max(...f.lignes.map(l => l.length)) - 1)}$${f.lignes.length}</definedName>` : '').join('') + '</definedNames>' : ''}</workbook>` },
    { nom: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${feuilles.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${feuilles.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nom: 'xl/styles.xml', data: STYLES },
    ...feuilles.map((f, i) => ({ nom: `xl/worksheets/sheet${i + 1}.xml`, data: feuilleXml(f) })),
  ];
  return zip(fichiers);
}

module.exports = { classeur };
