// ===============================
// JS MINIFIER (simple, remove comments & whitespaces)
export function minifyJS(code) {
  return code
    .replace(/\/\/.*$/gm, "")         // single line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\s+/g, " ")             // multiple whitespaces → single space
    .replace(/\s*([\{\}\[\]\(\)=;:,])\s*/g, "$1") // trim around symbols
    .trim();
}

// ===============================
// CSS MINIFIER (remove comments + spaces)
export function minifyCSS(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\s+/g, " ")
    .replace(/\s*([\{\}:;,])\s*/g, "$1")
    .trim();
}

// ===============================
// JSON MINIFIER
export function minifyJSON(code) {
  try {
    const obj = JSON.parse(code);
    return JSON.stringify(obj);
  } catch (e) {
    return code; // fallback if invalid JSON
  }
}

// ===============================
// HTML MINIFIER (very simple)
export function minifyHTML(code) {
  return code
    .replace(/<!--[\s\S]*?-->/g, "") // remove comments
    .replace(/\s+/g, " ")            // collapse whitespace
    .replace(/>\s+</g, "><")         // remove space between tags
    .trim();
}
