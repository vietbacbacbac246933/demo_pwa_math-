'use strict';

import {
  assertSameOrigin,
  handleError,
  json,
  methodNotAllowed
} from '../../_lib/http.js';
import { clearSessionCookie } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    return json({ ok: true }, 200, {
      'Set-Cookie': clearSessionCookie(context.request)
    });
  } catch (error) {
    return handleError(error);
  }
}

export function onRequest() {
  return methodNotAllowed('POST');
}
