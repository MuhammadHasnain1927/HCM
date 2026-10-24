// Single source of "now" for business rules. Production always uses the real
// clock; tests can pin a time to check rules like "late after 09:15".
let fixed = null;

export const now = () => (fixed ? new Date(fixed) : new Date());

/** Test-only: pin the clock to an instant (Date or ISO string); null restores it. */
export function setNow(value) {
  if (process.env.NODE_ENV !== 'test') throw new Error('setNow is only available in tests');
  fixed = value ? new Date(value).getTime() : null;
}
