let _globalStamp: (() => void) | null = null;

export function registerGlobalStampActivity(fn: (() => void) | null) {
  _globalStamp = fn;
}

/** Call this after any successful mutation to mark the current user as active. */
export function globalStampActivity() {
  _globalStamp?.();
}
