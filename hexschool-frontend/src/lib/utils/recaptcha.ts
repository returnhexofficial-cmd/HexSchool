/**
 * Google reCAPTCHA v3 helper for the public admission forms (M10).
 * Disabled (returns undefined) when NEXT_PUBLIC_RECAPTCHA_SITE_KEY is
 * unset — the backend skips verification when its secret is empty too.
 */

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? "";

interface Grecaptcha {
  ready(cb: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
  }
}

let scriptPromise: Promise<Grecaptcha> | null = null;

function loadRecaptcha(): Promise<Grecaptcha> {
  scriptPromise ??= new Promise((resolve, reject) => {
    if (window.grecaptcha) {
      window.grecaptcha.ready(() => resolve(window.grecaptcha!));
      return;
    }
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${SITE_KEY}`;
    script.async = true;
    script.onload = () => {
      window.grecaptcha!.ready(() => resolve(window.grecaptcha!));
    };
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load reCAPTCHA"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Token for the given action, or undefined when reCAPTCHA is disabled. */
export async function getRecaptchaToken(
  action: string,
): Promise<string | undefined> {
  if (!SITE_KEY || typeof window === "undefined") return undefined;
  const grecaptcha = await loadRecaptcha();
  return grecaptcha.execute(SITE_KEY, { action });
}
