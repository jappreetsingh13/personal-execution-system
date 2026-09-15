import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { strToU8, zipSync } from 'fflate';
import type { Note, Task } from '@/types';
import { IMPORTANCE_LABELS } from '@/theme/themes';
import { formatLongDate, formatTime } from './date';
import { describeRecurrence } from './recurrence';

/**
 * Sharing a note or a task as a real file.
 *
 * Everything is rendered from one neutral `Doc` shape so the three formats can never drift apart —
 * the PDF and the Word file say exactly what the plain text says.
 */

export type ShareFormat = 'txt' | 'pdf' | 'docx';

export type DocSection = { title: string; body: string };

export type Doc = {
  title: string;
  /** Short facts under the title: time, repeat rule, importance. */
  meta: string[];
  body: string;
  sections: DocSection[];
  /** Names of the linked records on the other side of the relation. */
  links: string[];
  linksHeading: string;
};

export const FORMAT_LABELS: Record<ShareFormat, string> = {
  txt: 'Plain text (.txt)',
  pdf: 'PDF (.pdf)',
  docx: 'Word (.docx)',
};

const MIME: Record<ShareFormat, string> = {
  txt: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// ---------------------------------------------------------------------------
// Building a Doc
// ---------------------------------------------------------------------------

export function noteDoc(note: Note, tasks: Record<string, Task>): Doc {
  const linked = note.linkedTaskIds
    .map((id) => tasks[id])
    .filter((t): t is Task => t != null)
    .map((t) => `${t.title} — ${formatTime(t.minutes)}, ${describeRecurrence(t.recurrence)}`);

  return {
    title: note.title.trim() || 'Untitled note',
    meta: [`Importance: ${IMPORTANCE_LABELS[note.importance]}`],
    body: note.body,
    sections: note.sections
      .filter((s) => s.title.trim() || s.body.trim())
      .map((s) => ({ title: s.title.trim() || 'Untitled section', body: s.body })),
    links: linked,
    linksHeading: 'Linked tasks',
  };
}

export function taskDoc(task: Task, notes: Record<string, Note>): Doc {
  const linked = task.linkedNoteIds
    .map((id) => notes[id])
    .filter((n): n is Note => n != null)
    .map((n) => n.title.trim() || 'Untitled note');

  const meta = [
    `Time: ${formatTime(task.minutes)}`,
    `Repeat: ${describeRecurrence(task.recurrence)}`,
    `Starts: ${formatLongDate(task.startDate)}`,
  ];
  if (task.endDate) meta.push(`Ends: ${formatLongDate(task.endDate)}`);
  meta.push(`Importance: ${IMPORTANCE_LABELS[task.importance]}`);

  return {
    title: task.title.trim() || 'Untitled task',
    meta,
    body: task.details ?? '',
    sections: task.sections
      .filter((s) => s.title.trim() || s.body.trim())
      .map((s) => ({ title: s.title.trim() || 'Untitled section', body: s.body })),
    links: linked,
    linksHeading: 'Linked notes',
  };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderText(doc: Doc): string {
  const out: string[] = [doc.title, '='.repeat(Math.min(doc.title.length, 60)), ''];

  if (doc.meta.length) {
    out.push(...doc.meta, '');
  }
  if (doc.body.trim()) {
    out.push(doc.body.trim(), '');
  }
  for (const section of doc.sections) {
    out.push(`--- ${section.title} ---`);
    if (section.body.trim()) out.push(section.body.trim());
    out.push('');
  }
  if (doc.links.length) {
    out.push(`${doc.linksHeading}:`);
    for (const link of doc.links) out.push(`  • ${link}`);
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtml(doc: Doc): string {
  const paragraphs = (text: string) =>
    text
      .split(/\n{2,}/)
      .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br/>')}</p>`)
      .join('');

  const sections = doc.sections
    .map(
      (s) =>
        `<section><h2>${escapeHtml(s.title)}</h2>${
          s.body.trim() ? paragraphs(s.body.trim()) : '<p class="muted">—</p>'
        }</section>`,
    )
    .join('');

  const links = doc.links.length
    ? `<section><h2>${escapeHtml(doc.linksHeading)}</h2><ul>${doc.links
        .map((l) => `<li>${escapeHtml(l)}</li>`)
        .join('')}</ul></section>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  body { font-family: -apple-system, "Helvetica Neue", Roboto, sans-serif; color: #1c2430;
         padding: 40px 44px; line-height: 1.55; font-size: 14px; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  h2 { font-size: 15px; margin: 26px 0 6px; text-transform: uppercase;
       letter-spacing: 0.06em; color: #5a6b7d; }
  .meta { color: #5a6b7d; font-size: 12.5px; margin: 0 0 22px; }
  .meta span { margin-right: 14px; white-space: nowrap; }
  p { margin: 0 0 10px; }
  ul { margin: 0; padding-left: 20px; }
  .muted { color: #8b98a6; }
  section { page-break-inside: avoid; }
</style></head><body>
<h1>${escapeHtml(doc.title)}</h1>
<p class="meta">${doc.meta.map((m) => `<span>${escapeHtml(m)}</span>`).join('')}</p>
${doc.body.trim() ? paragraphs(doc.body.trim()) : ''}
${sections}
${links}
</body></html>`;
}

// ---- DOCX -----------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * One Word paragraph. Formatting is applied directly rather than through named styles, so the
 * package needs no styles.xml — which keeps this to three parts and no style resolution to get
 * wrong.
 *
 * `size` is in half-points, the unit OOXML actually uses: 28 renders as 14pt.
 */
function docxParagraph(
  text: string,
  opts: { bold?: boolean; size?: number; color?: string; spaceBefore?: number } = {},
): string {
  const { bold, size, color, spaceBefore } = opts;
  const rPr = [
    bold ? '<w:b/>' : '',
    size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : '',
    color ? `<w:color w:val="${color}"/>` : '',
  ].join('');
  const pPr = spaceBefore ? `<w:pPr><w:spacing w:before="${spaceBefore}"/></w:pPr>` : '';
  const runs = text.length
    ? `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(
        text,
      )}</w:t></w:r>`
    : '';
  return `<w:p>${pPr}${runs}</w:p>`;
}

function docxBlocks(text: string): string {
  return text
    .split('\n')
    .map((line) => docxParagraph(line))
    .join('');
}

function renderDocxXml(doc: Doc): string {
  const parts: string[] = [
    docxParagraph(doc.title, { bold: true, size: 40 }),
    ...doc.meta.map((m) => docxParagraph(m, { size: 18, color: '5A6B7D' })),
    docxParagraph(''),
  ];

  if (doc.body.trim()) {
    parts.push(docxBlocks(doc.body.trim()), docxParagraph(''));
  }

  for (const section of doc.sections) {
    parts.push(docxParagraph(section.title, { bold: true, size: 26, spaceBefore: 220 }));
    parts.push(docxBlocks(section.body.trim() || '—'));
    parts.push(docxParagraph(''));
  }

  if (doc.links.length) {
    parts.push(docxParagraph(doc.linksHeading, { bold: true, size: 26, spaceBefore: 220 }));
    for (const link of doc.links) parts.push(docxParagraph(`• ${link}`));
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.join(
    '',
  )}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

/** A .docx is just a zip of three XML parts. */
function renderDocx(doc: Doc): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'word/document.xml': strToU8(renderDocxXml(doc)),
    },
    { level: 6 },
  );
}

// ---------------------------------------------------------------------------
// Writing and sharing
// ---------------------------------------------------------------------------

/** Keep only characters that are safe in a filename on every platform a share can land on. */
function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || 'Untitled';
}

function writeFile(name: string, content: string | Uint8Array): string {
  const file = new File(Paths.cache, name);
  // Overwrite rather than append: sharing the same note twice must not stack its contents.
  file.create({ overwrite: true, intermediates: true });
  file.write(content);
  return file.uri;
}

async function buildFile(doc: Doc, format: ShareFormat): Promise<string> {
  const base = safeFileName(doc.title);

  if (format === 'txt') return writeFile(`${base}.txt`, renderText(doc));
  if (format === 'docx') return writeFile(`${base}.docx`, renderDocx(doc));

  const { uri } = await Print.printToFileAsync({ html: renderHtml(doc) });
  // printToFileAsync writes to a randomly named temporary. Rename it, because that name is what
  // the recipient sees in whatever app the file lands in.
  try {
    const printed = new File(uri);
    const target = new File(Paths.cache, `${base}.pdf`);
    await printed.move(target, { overwrite: true });
    return target.uri;
  } catch {
    return uri;
  }
}

/**
 * Render and hand off to the system share sheet.
 *
 * Returns false when sharing is unavailable on the device, so the caller can say so rather than
 * appearing to do nothing.
 */
export async function shareDoc(doc: Doc, format: ShareFormat): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const uri = await buildFile(doc, format);
  await Sharing.shareAsync(uri, {
    mimeType: MIME[format],
    dialogTitle: `Share "${doc.title}"`,
    UTI: format === 'pdf' ? 'com.adobe.pdf' : undefined,
  });
  return true;
}
