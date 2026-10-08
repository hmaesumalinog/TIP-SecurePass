// Answers without touching the database. Entry pages call it while the person
// is still typing, so the API function is already running for the real request.
export default async function health(request) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return Response.json({ message: 'Method not allowed.' }, { status: 405, headers: { 'Cache-Control': 'no-store' } });
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
