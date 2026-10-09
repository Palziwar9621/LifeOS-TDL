// Only allowlisted messages cross the assistant boundary. Never display SDK or provider bodies.
export const ASSISTANT_ERRORS = {
  ai_disabled: 'AI is turned off. Enable AI in Assistant settings for this request.',
  guest: 'Sign in to use AI for this request. Simple offline commands still work.',
  auth_expired: 'Your sign-in has expired. Sign in again to use AI.',
  network: 'AI could not connect. Check your connection and try again.',
  unconfigured: 'AI is not configured. Check the app connection and assistant service setup.',
  rate_limit: 'AI is busy or its request limit was reached. Please try again shortly.',
  invalid_contract: 'AI returned an invalid action. Nothing was changed; please rephrase and try again.',
  unavailable: 'AI is temporarily unavailable. Please try again.',
  cancelled: 'Request stopped.',
} as const;
export type AssistantErrorCode = keyof typeof ASSISTANT_ERRORS;
export class AssistantError extends Error {
  readonly code: AssistantErrorCode;
  // True only when planning never started; permits explicit local commands.
  readonly offlineAllowed: boolean;
  constructor(code: AssistantErrorCode, offlineAllowed = false) {
    super(ASSISTANT_ERRORS[code]);
    this.name = 'AssistantError'; this.code = code; this.offlineAllowed = offlineAllowed;
  }
}
export function assistantError(error: unknown): AssistantError {
  if (error instanceof AssistantError) return error;
  if (error instanceof Error && error.name === 'AbortError') return new AssistantError('cancelled');
  if (error instanceof SyntaxError) return new AssistantError('invalid_contract');
  return new AssistantError('network');
}
export function assistantErrorCode(value: unknown): AssistantErrorCode | undefined {
  return typeof value === 'string' && Object.hasOwn(ASSISTANT_ERRORS, value) ? value as AssistantErrorCode : undefined;
}
