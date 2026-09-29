// Base class for any failure talking to the Support Chat API — network
// errors, unexpected response shapes, or a rejected request. Unlike
// src/crm/errors.ts, there's no documented set of specific error bodies to
// map to dedicated subclasses yet (this API is brand new, 2026-09-29) — add
// them here once real error responses are confirmed, same as CRM's
// evolved.
export class SupportChatApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "SupportChatApiError";
    this.status = status;
  }
}
