// Validates req.body / req.query / req.params against zod schemas and replaces
// them with the parsed (trimmed, coerced) values. Unknown fields are dropped.
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    if (body) req.body = body.parse(req.body ?? {});
    // In Express 5 req.query is a getter, so parsed values go on req.validQuery.
    if (query) req.validQuery = query.parse(req.query ?? {});
    if (params) req.validParams = params.parse(req.params ?? {});
    next();
  };
}
