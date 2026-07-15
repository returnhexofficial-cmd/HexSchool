import { configureStore } from "@reduxjs/toolkit";
import { authReducer } from "./auth-slice";

/**
 * Store factory (App Router pattern: one store instance per browser tab,
 * created inside StoreProvider — never a module-level singleton, which
 * would leak state across requests during SSR).
 */
export function makeStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
    },
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
