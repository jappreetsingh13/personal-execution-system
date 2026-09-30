import * as IntentLauncher from 'expo-intent-launcher';
import { Directory, File, Paths } from 'expo-file-system';
import type { Attachment } from '@/types';
import { makeId } from './id';

/**
 * Attachments are *copies*, made at pick time, of whatever the user selected.
 * Picker URIs point into the system cache or a content provider and can be
 * revoked at any moment — copying into the app's own documents directory on
 * the day of picking is what makes the attachment survive.
 */

const attachmentsDir = new Directory(Paths.document, 'attachments');

function ensureDir() {
  if (!attachmentsDir.exists) {
    attachmentsDir.create({ idempotent: true, intermediates: true });
  }
}

/** Strip anything a filesystem or an intent filter would choke on. */
function sanitizeName(name: string): string {
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(-80) : 'file';
}

type PickedAsset = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  size?: number | null;
};

async function copyIntoStorage(
  asset: PickedAsset,
  kind: Attachment['kind'],
): Promise<Attachment | null> {
  ensureDir();
  const name = sanitizeName(asset.name ?? asset.uri.split('/').pop() ?? 'file');
  const target = new File(attachmentsDir, `${makeId()}-${name}`);
  try {
    await new File(asset.uri).copy(target, { overwrite: true });
  } catch (err) {
    console.warn('[attachments] copy failed', asset.uri, err);
    return null;
  }
  return {
    id: makeId(),
    kind,
    uri: target.uri,
    name,
    mimeType: asset.mimeType ?? undefined,
    size: asset.fileSize ?? asset.size ?? undefined,
  };
}

/** Copy a batch of photos from the image picker into app storage. */
export async function saveImageAttachments(
  assets: PickedAsset[],
): Promise<Attachment[]> {
  const saved = await Promise.all(assets.map((a) => copyIntoStorage(a, 'image')));
  return saved.filter((a): a is Attachment => a != null);
}

/** Copy a batch of documents from the document picker into app storage. */
export async function saveFileAttachments(assets: PickedAsset[]): Promise<Attachment[]> {
  const saved = await Promise.all(assets.map((a) => copyIntoStorage(a, 'file')));
  return saved.filter((a): a is Attachment => a != null);
}

/** Remove the underlying files. Fire-and-forget safe — a missing file is not an error. */
export async function deleteAttachmentFiles(attachments: Attachment[]): Promise<void> {
  await deleteAttachmentUris(attachments.map((a) => a.uri));
}

/**
 * Same sweep, for callers that only kept the uri.
 *
 * Photos placed on a sketch page are copies in the same `attachments` directory,
 * but a `SketchImage` stores just the uri — it has no `Attachment` record to pass
 * to `deleteAttachmentFiles`. Without this, deleting a sketch leaked every photo
 * on it forever.
 */
export async function deleteAttachmentUris(uris: string[]): Promise<void> {
  for (const uri of uris) {
    // Only ever delete our own copies. Early sketches stored the raw picker
    // uri, and a stray `content://` here would mean deleting the user's photo
    // out of their gallery.
    if (!uri.startsWith(attachmentsDir.uri)) continue;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // Already gone, or the uri never pointed anywhere — nothing to do.
    }
  }
}

/**
 * Hand a file to Android's viewer. The system chooses the app by mime type;
 * `FLAG_GRANT_READ_URI_PERMISSION` lets the receiving app read our private file.
 * Content URIs via FileProvider would be needed to share outside the app —
 * for *viewing*, a direct file path with the grant flag works.
 */
export function openAttachment(attachment: Attachment): void {
  // `ActivityAction` only enumerates the settings screens; the plain view
  // action is passed through as a raw string, which the API accepts.
  IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: attachment.uri,
    type: attachment.mimeType || '*/*',
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  }).catch((err) => console.warn('[attachments] open failed', err));
}

export function formatBytes(bytes?: number): string | null {
  if (bytes == null || Number.isNaN(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
