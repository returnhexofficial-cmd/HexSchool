import { SetMetadata } from '@nestjs/common';

export const SKIP_ENVELOPE_KEY = 'skipEnvelope';

/**
 * Opt a handler out of the global `{ success, data }` response envelope
 * (e.g. file streams, iCal exports, webhook echoes).
 */
export const SkipEnvelope = () => SetMetadata(SKIP_ENVELOPE_KEY, true);
