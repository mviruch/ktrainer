const mem: Record<string, string> = {};
let ok = true;
try {
  localStorage.setItem("__t", "1");
  localStorage.removeItem("__t");
} catch {
  ok = false;
}

type FailHook = (key: string, err: unknown) => void;
let failHook: FailHook | null = null;

/** Shell hook: called whenever a real localStorage write fails (quota, blocked). */
export function onStoreFail(fn: FailHook | null) {
  failHook = fn;
}

export const store = {
  persistent: ok,
  get<T>(k: string, d: T): T {
    try {
      const v = ok ? localStorage.getItem(k) : mem[k];
      return v == null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    const s = JSON.stringify(v);
    try {
      if (ok) localStorage.setItem(k, s);
      else mem[k] = s;
      return true;
    } catch (err) {
      mem[k] = s;
      try {
        failHook?.(k, err);
      } catch {
        /* never let the hook break a save path */
      }
      return false;
    }
  },
  del(k: string) {
    try {
      if (ok) localStorage.removeItem(k);
    } catch {
      /* private mode */
    }
    delete mem[k];
  },
};
