export function onRequest() {
  return new Response('Gone', {
    status: 410,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-robots-tag': 'noindex',
    },
  });
}
