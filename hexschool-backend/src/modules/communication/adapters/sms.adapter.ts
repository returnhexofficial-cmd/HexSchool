/**
 * SMS delivery contract (roadmap M17 §4 "SMS provider adapter interface +
 * one concrete BD adapter (configurable HTTP gateway: url, params mapping,
 * masking/non-masking sender id)").
 *
 * BD SMS gateways are near-identical HTTP endpoints — an api key, a sender
 * id, the number and the text — so one configurable adapter covers the
 * common case. When credentials are absent the dispatcher falls back to
 * the log adapter, exactly as the M02 interim processor did, so dev and
 * e2e complete the pipeline without a live gateway.
 */

export interface SmsCredentials {
  enabled: boolean;
  provider: string;
  apiUrl: string;
  apiKey: string;
  senderId: string;
  /** Masked sender ids are branded but cost more; non-masked are numeric. */
  masking: boolean;
}

export interface SmsSendInput {
  to: string;
  text: string;
  /** UCS-2 body — some gateways need an explicit type flag. */
  unicode: boolean;
}

export interface SmsSendResult {
  accepted: boolean;
  /** The gateway's message handle, correlated by the DLR webhook. */
  providerMsgId?: string;
  error?: string;
  raw: Record<string, unknown>;
}

export interface SmsAdapter {
  readonly name: string;
  isConfigured(credentials: SmsCredentials): boolean;
  send(
    input: SmsSendInput,
    credentials: SmsCredentials,
  ): Promise<SmsSendResult>;
}

/** DI token for the concrete HTTP adapter (swap for a mock in e2e). */
export const SMS_ADAPTER = Symbol('SMS_ADAPTER');
