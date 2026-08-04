// Base class for any failure talking to the CRM API — network errors,
// unexpected response shapes, or a documented error we don't recognize.
export class CrmApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "CrmApiError";
    this.status = status;
  }
}

export class CrmInvalidTokenError extends CrmApiError {
  constructor(message = "Invalid CRM token") {
    super(message);
    this.name = "CrmInvalidTokenError";
  }
}

export class CrmInvalidUserIdError extends CrmApiError {
  constructor(message = "Valid user id is required") {
    super(message);
    this.name = "CrmInvalidUserIdError";
  }
}

// This is expected to be OUR NORMAL STATE until our server's IP is
// allowlisted by Satyam's team — every call will fail with this until then.
// It's its own error class (not just a generic CrmApiError) specifically so
// callers/logs can tell "not allowlisted yet" apart from "something is
// actually broken."
export class CrmIpNotAllowedError extends CrmApiError {
  constructor(message = "IP address is not allowed") {
    super(message);
    this.name = "CrmIpNotAllowedError";
  }
}

// Maps the doc's three documented { status: false, message } failure
// bodies to their specific error class. Anything else (unrecognized
// message, or no message at all) falls back to the generic CrmApiError.
export function mapCrmError(body: { message?: string } | undefined, status?: number): CrmApiError {
  const message = body?.message;
  if (message === "Invalid CRM token") return new CrmInvalidTokenError(message);
  if (message === "Valid user id is required") return new CrmInvalidUserIdError(message);
  if (message === "IP address is not allowed") return new CrmIpNotAllowedError(message);
  return new CrmApiError(message || "CRM API request failed", status);
}
