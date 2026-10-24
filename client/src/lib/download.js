import { api } from './api.js';

/**
 * Downloads a file from an authenticated API route (payslip PDF, CSV export).
 * Uses the API client so the Bearer token is sent, then saves the blob.
 */
export async function downloadFile(url, fallbackName, { params } = {}) {
  const res = await api.get(url, { params, responseType: 'blob' });
  const disposition = res.headers['content-disposition'] ?? '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const name = match?.[1] ?? fallbackName;
  const href = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Saves text the browser already has (e.g. imported credentials) as a file. */
export function saveText(text, name, type = 'text/csv') {
  const href = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/**
 * Error message from a failed blob request (axios gives the JSON error as a Blob).
 */
export async function blobErrorMessage(error, fallback = 'Download failed. Please try again.') {
  try {
    const data = error?.response?.data;
    if (data instanceof Blob) {
      const json = JSON.parse(await data.text());
      return json?.error?.message ?? fallback;
    }
  } catch {
    /* not JSON */
  }
  return fallback;
}
