/**
 * Shared enum registry (roadmap global convention): the PG enums are
 * declared in prisma/schema.prisma and generated into @prisma/client;
 * re-exported here so app code has one canonical import path that
 * mirrors the frontend copy (`src/lib/constants/enums.ts`).
 */
export {
  UserType,
  UserStatus,
  OtpPurpose,
  LoginEvent,
  SchoolType,
  SchoolStatus,
  SettingsGroup,
  SessionStatus,
  HolidayType,
  HolidayAppliesTo,
  CalendarEventType,
} from '@prisma/client';
