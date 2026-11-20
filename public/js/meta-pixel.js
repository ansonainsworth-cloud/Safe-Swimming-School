export function trackMeta(target, eventName, params) {
  const fbq = target && target.fbq;
  if (typeof fbq !== 'function') return;
  let safe;
  if (params && typeof params === 'object') {
    safe = {};
    if (typeof params.value === 'number') safe.value = params.value;
    if (params.currency === 'USD') safe.currency = 'USD';
    if (typeof params.content_name === 'string' && params.content_name && !/[@+]/.test(params.content_name)) {
      safe.content_name = params.content_name;
    }
    if (!Object.keys(safe).length) safe = undefined;
  }
  try {
    if (safe) fbq('track', eventName, safe);
    else fbq('track', eventName);
  } catch {
    /* The pixel can reject an event. The click still continues. */
  }
}
