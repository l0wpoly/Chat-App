import type { MediaCategory } from '../types';

const AVATAR_SIZE = 256;
const AVATAR_MAX_BYTES = 50 * 1024; // 50 KB
const CHAT_IMAGE_MAX_DIM = 1600;
const CHAT_IMAGE_TARGET_BYTES = 1024 * 1024; // 1 MB
const CHAT_GIF_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const CHAT_VIDEO_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const CHAT_AUDIO_MAX_BYTES = 15 * 1024 * 1024; // 15 MB

const ALLOWED_VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
  'audio/aac',
]);
const ALLOWED_IMAGE_MIMES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif']);

export interface PreparedMedia {
  category: Exclude<MediaCategory, 'text'>;
  blob: Blob;
  ext: string;
  mime: string;
  name: string;
  originalBytes: number;
  finalBytes: number;
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image file.'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Image encoding failed in this browser.'));
          return;
        }
        resolve(blob);
      },
      mime,
      quality
    );
  });
}

export async function compressAvatarToWebP(
  file: File
): Promise<{ blob: Blob; originalBytes: number; finalBytes: number }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file for your avatar.');
  }

  const img = await loadImageElement(file);
  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;
  const cropSide = Math.min(srcWidth, srcHeight);
  const sx = Math.floor((srcWidth - cropSide) / 2);
  const sy = Math.floor((srcHeight - cropSide) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, cropSide, cropSide, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  const qualities = [0.72, 0.6, 0.5, 0.4, 0.3, 0.22];
  let bestBlob: Blob | null = null;

  for (const q of qualities) {
    const blob = await canvasToBlob(canvas, 'image/webp', q);
    bestBlob = blob;
    if (blob.size <= AVATAR_MAX_BYTES) {
      return {
        blob,
        originalBytes: file.size,
        finalBytes: blob.size,
      };
    }
  }

  if (!bestBlob || bestBlob.size > 54000) {
    throw new Error('Image could not be compressed under 50 KB. Try a simpler image.');
  }

  return {
    blob: bestBlob,
    originalBytes: file.size,
    finalBytes: bestBlob.size,
  };
}

function inferMimeFromFilename(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') {
    return file.type === 'audio/x-wav'
      ? 'audio/wav'
      : file.type === 'audio/mp3'
        ? 'audio/mpeg'
        : file.type === 'audio/x-m4a' || file.type === 'audio/m4a'
          ? 'audio/mp4'
          : file.type;
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'webp':
      return 'image/webp';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    case 'aac':
      return 'audio/aac';
    default:
      return file.type || '';
  }
}

function extFromMime(mime: string, originalName: string): string {
  const fromName = originalName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  switch (mime) {
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'video/quicktime':
      return 'mov';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/webm':
      return 'weba';
    case 'audio/flac':
      return 'flac';
    case 'audio/aac':
      return 'aac';
    default:
      return fromName || 'bin';
  }
}

export async function prepareChatMedia(file: File): Promise<PreparedMedia> {
  const mime = inferMimeFromFilename(file);

  if (ALLOWED_IMAGE_MIMES.has(mime) || mime.startsWith('image/')) {
    if (mime === 'image/gif') {
      if (file.size > CHAT_GIF_MAX_BYTES) {
        throw new Error('GIF exceeds the 2 MB limit.');
      }
      return {
        category: 'image',
        blob: file,
        ext: 'gif',
        mime: 'image/gif',
        name: file.name,
        originalBytes: file.size,
        finalBytes: file.size,
      };
    }

    const img = await loadImageElement(file);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    const scale = Math.min(1, CHAT_IMAGE_MAX_DIM / Math.max(srcW, srcH));
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, dstW, dstH);

    const qualities = [0.78, 0.65, 0.5, 0.35];
    let encoded: Blob | null = null;
    for (const q of qualities) {
      const candidate = await canvasToBlob(canvas, 'image/webp', q);
      encoded = candidate;
      if (candidate.size <= CHAT_IMAGE_TARGET_BYTES) break;
    }

    if (!encoded) throw new Error('Image compression failed.');
    if (encoded.size > CHAT_VIDEO_MAX_BYTES) {
      throw new Error('Compressed image still exceeds upload limits.');
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    return {
      category: 'image',
      blob: encoded,
      ext: 'webp',
      mime: 'image/webp',
      name: `${baseName}.webp`,
      originalBytes: file.size,
      finalBytes: encoded.size,
    };
  }

  if (ALLOWED_VIDEO_MIMES.has(mime)) {
    if (file.size > CHAT_VIDEO_MAX_BYTES) {
      throw new Error('Video exceeds the 25 MB upload cap.');
    }
    return {
      category: 'video',
      blob: file,
      ext: extFromMime(mime, file.name),
      mime,
      name: file.name,
      originalBytes: file.size,
      finalBytes: file.size,
    };
  }

  if (ALLOWED_AUDIO_MIMES.has(mime)) {
    if (file.size > CHAT_AUDIO_MAX_BYTES) {
      throw new Error('Audio file exceeds the 15 MB upload cap.');
    }
    return {
      category: 'audio',
      blob: file,
      ext: extFromMime(mime, file.name),
      mime,
      name: file.name,
      originalBytes: file.size,
      finalBytes: file.size,
    };
  }

  throw new Error(
    'Unsupported file type. Send images (WebP/PNG/JPG/GIF), video (MP4/WebM/MOV), or audio (MP3/M4A/WAV/OGG/FLAC/AAC).'
  );
}
