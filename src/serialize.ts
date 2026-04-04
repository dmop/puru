const NATIVE_CODE_RE = /\[native code\]/;
const METHOD_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/;

// A valid serialized function must start with one of these patterns.
// This guards against prototype pollution on Function.prototype.toString
// returning arbitrary strings.
const VALID_FN_START_RE =
  /^(?:function\b|async\s+function\b|async\s*\(|\(|[a-zA-Z_$][a-zA-Z0-9_$]*\s*=>|async\s+[a-zA-Z_$])/;

const serializeCache = new WeakMap<Function, string>();

export function serializeFunction(fn: Function): string {
  if (typeof fn !== "function") {
    throw new TypeError("Expected a function");
  }

  const cached = serializeCache.get(fn);
  if (cached) return cached;

  const str = fn.toString();

  if (typeof str !== "string" || str.length === 0) {
    throw new TypeError(
      "Function serialization returned an invalid result. " +
        "This may indicate Function.prototype.toString has been tampered with.",
    );
  }

  if (NATIVE_CODE_RE.test(str)) {
    throw new TypeError(
      "Native functions cannot be serialized. Use an arrow function wrapper instead.",
    );
  }

  if (!VALID_FN_START_RE.test(str)) {
    throw new TypeError(
      "Function serialization produced unexpected output. " +
        "Only arrow functions, function expressions, and async functions are supported.",
    );
  }

  // Detect class methods like "method() { ... }" — not valid standalone functions
  if (
    METHOD_RE.test(str) &&
    !str.startsWith("function") &&
    !str.startsWith("async function") &&
    !str.startsWith("async (") &&
    !str.startsWith("async=") &&
    !str.startsWith("(") &&
    !str.includes("=>")
  ) {
    throw new TypeError(
      "Class methods cannot be serialized. Use an arrow function wrapper instead.",
    );
  }

  serializeCache.set(fn, str);
  return str;
}
