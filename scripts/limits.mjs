export const DEFAULT_ARCHIVE_BYTES = 100 * 1024 * 1024;
export const DEFAULT_DOWNLOAD_BYTES = 64 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const DEFAULT_DOWNLOAD_TIMEOUT = 30_000;
export const MAX_DOWNLOAD_TIMEOUT = 120_000;

/** Larger budgets apply only to a reviewed immutable release, never to an arbitrary latest version. */
export function archiveBudget(input, version, integrity) {
  const review = input.archiveReview;
  if (review === undefined) return { maxUnpackedBytes: DEFAULT_ARCHIVE_BYTES, maxDownloadBytes: DEFAULT_DOWNLOAD_BYTES, timeoutMs: DEFAULT_DOWNLOAD_TIMEOUT };
  if (input.version !== version || review.version !== version || review.integrity !== integrity) throw new Error('Archive review must match the pinned package version and integrity');
  if (!Number.isSafeInteger(review.maxUnpackedBytes) || review.maxUnpackedBytes < 1 || review.maxUnpackedBytes > MAX_ARCHIVE_BYTES) throw new Error('Archive budget must be between 1 byte and 256 MiB');
  if (!Number.isSafeInteger(review.timeoutMs) || review.timeoutMs < 1 || review.timeoutMs > MAX_DOWNLOAD_TIMEOUT) throw new Error('Archive download timeout must be between 1 and 120000 ms');
  const maxDownloadBytes = review.maxDownloadBytes ?? DEFAULT_DOWNLOAD_BYTES;
  if (!Number.isSafeInteger(maxDownloadBytes) || maxDownloadBytes < 1 || maxDownloadBytes > MAX_ARCHIVE_BYTES) throw new Error('Download budget must be between 1 byte and 256 MiB');
  return { maxUnpackedBytes: review.maxUnpackedBytes, maxDownloadBytes, timeoutMs: review.timeoutMs };
}
