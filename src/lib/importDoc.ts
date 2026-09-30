import { File } from 'expo-file-system';
import { unzipSync, strFromU8 } from 'fflate';

/**
 * Import a document's text for a note. Everything read goes into the note
 * body and nowhere else; the caller derives the title. Supported: plain text
 * (.txt/.md/anything textual) and Word (.docx — a real OOXML zip, parsed here
 * with fflate, which the app already ships for the export side). Legacy
 * binary .doc and PDF are deliberately rejected: neither can be read without
 * a native parser, and a garbled import is worse than none.
 */

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

/** A .docx is a zip; its text lives in word/document.xml, one <w:p> per paragraph. */
function docxToText(bytes: Uint8Array): string {
  let xml: string;
  try {
    const zip = unzipSync(bytes);
    const entry = zip['word/document.xml'];
    if (!entry) throw new Error('word/document.xml missing');
    xml = strFromU8(entry);
  } catch {
    throw new Error('NOT_A_DOCX');
  }
  const paragraphs = xml
    .split(/<\/w:p>/)
    .map((p) => [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(''))
    .map(decodeXmlEntities)
    .filter((p) => p.trim().length > 0);
  return paragraphs.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function looksLikeDocx(name: string, mimeType?: string | null): boolean {
  return (
    mimeType === DOCX_MIME ||
    /\.docx$/i.test(name)
  );
}

/**
 * Read the picked file and return its text plus a title built from the first
 * 35 characters. Throws Error('UNSUPPORTED') for anything that is not text or
 * .docx so the caller can show a useful message.
 */
export async function readImportedDocument(asset: {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
}): Promise<{ title: string; body: string }> {
  const name = asset.name ?? 'imported';
  const file = new File(asset.uri);
  if (!file.exists) throw new Error('UNSUPPORTED');

  let body: string;
  if (looksLikeDocx(name, asset.mimeType)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    body = docxToText(bytes);
  } else if (/\.(txt|md|markdown|csv|log|json)$/i.test(name) || asset.mimeType?.startsWith('text/')) {
    body = (await file.text()).replace(/\r\n/g, '\n').trim();
  } else {
    throw new Error('UNSUPPORTED');
  }

  if (!body) throw new Error('EMPTY');
  // Markdown headings and other decorations ("### My Title", "-----") often
  // lead the document — the title must start where the first real letter or
  // digit starts, so skip everything before it.
  const flattened = body.replace(/\s+/g, ' ').trim().replace(/^[^A-Za-z0-9]+/, '');
  const title = flattened.slice(0, 35);
  return { title, body };
}
