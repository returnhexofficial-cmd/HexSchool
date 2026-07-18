import { AdmissionApplicationStatus } from '../../../common/constants';

export const ADMISSION_EVENTS = {
  APPLICATION_SUBMITTED: 'admission.application.submitted',
  STATUS_CHANGED: 'admission.application.status_changed',
} as const;

export interface ApplicationSubmittedEvent {
  applicationId: string;
  applicationNo: string;
  schoolId: string;
  phone: string;
  applicantName: string;
  className: string;
  /** Fee due (BDT); 0 = free application. */
  fee: number;
}

export interface ApplicationStatusChangedEvent {
  applicationId: string;
  applicationNo: string;
  schoolId: string;
  phone: string;
  from: AdmissionApplicationStatus;
  to: AdmissionApplicationStatus;
  /** Extra context for the SMS template (deadline, venue…). */
  note?: string;
}
