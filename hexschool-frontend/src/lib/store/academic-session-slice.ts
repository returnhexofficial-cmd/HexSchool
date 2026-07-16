import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * Global academic-session switcher state (roadmap M05 §5 — a global
 * convention from here on: every session-scoped page reads the selected
 * session from this slice via useAcademicSession()). Persistence to
 * localStorage happens in the hook, keyed per user.
 */
export interface AcademicSessionState {
  /** null until hydrated (localStorage → current session fallback). */
  selectedId: string | null;
}

const initialState: AcademicSessionState = { selectedId: null };

const academicSessionSlice = createSlice({
  name: "academicSession",
  initialState,
  reducers: {
    sessionSelected(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },
  },
});

export const { sessionSelected } = academicSessionSlice.actions;
export const academicSessionReducer = academicSessionSlice.reducer;
