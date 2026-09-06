export default {
  fetch(_request: Request): Response {
    return Response.json(
      {
        status: 'unavailable',
        stage: 'T01',
        reason: 'Production memory service is not implemented.',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  },
};
