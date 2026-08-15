/**
 * slug.ts — page title to a stable filename slug.
 *
 * Stability is the whole point: writing the same title twice must produce the
 * same slug, so the second write lands on the existing
 * `wiki/<type>/<slug>.md` and updates it instead of creating a near-duplicate.
 *
 * Rules (sources are often mixed Chinese/English):
 *   - Latin/digits: lowercase; spaces and punctuation become hyphens; leading,
 *     trailing and repeated hyphens are collapsed.
 *   - CJK: the characters are kept as they are — not romanised, not dropped.
 *     Romanising would make two different titles collide; dropping would make
 *     an all-CJK title slug to nothing at all.
 *   - Mixed: each run is handled by its own rule, then joined with a hyphen.
 */

// CJK Unified Ideographs plus Extension A and the compatibility block. These
// ranges are data, not text: they are how the scanner tells a CJK run from a
// Latin one. Chinese punctuation is deliberately absent — punctuation is a
// separator, handled by the else branch below.
const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;

function isCjkChar(ch: string): boolean {
  return CJK_RE.test(ch);
}

function isAlnumChar(ch: string): boolean {
  return /[a-zA-Z0-9]/.test(ch);
}

/**
 * Normalise a title into a stable slug.
 *
 * Scans character by character, splitting the input into alternating CJK and
 * Latin/digit runs joined by hyphens. Latin runs are lowercased; anything else
 * (space, punctuation) is treated as a run boundary.
 */
export function slugify(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "";

  const tokens: string[] = [];
  let buf = "";
  let bufKind: "cjk" | "latin" | null = null;

  const flush = () => {
    if (buf) {
      tokens.push(bufKind === "latin" ? buf.toLowerCase() : buf);
      buf = "";
    }
    bufKind = null;
  };

  for (const ch of trimmed) {
    if (isCjkChar(ch)) {
      if (bufKind !== "cjk") flush();
      bufKind = "cjk";
      buf += ch;
    } else if (isAlnumChar(ch)) {
      if (bufKind !== "latin") flush();
      bufKind = "latin";
      buf += ch;
    } else {
      // Space, punctuation, anything else — a run boundary.
      flush();
    }
  }
  flush();

  return tokens.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Page type to directory. Mirrors the directory layout created on init
 * (entities / concepts / sources / ...).
 */
const TYPE_DIR: Record<string, string> = {
  source: "sources",
  entity: "entities",
  concept: "concepts",
  comparison: "comparisons",
  synthesis: "synthesis",
  thesis: "synthesis",
  methodology: "concepts",
  finding: "synthesis",
};

/** Map a type to its directory; an unknown type gets a directory of its own name. */
export function dirForType(type: string): string {
  const key = (type ?? "").trim().toLowerCase();
  return TYPE_DIR[key] ?? `${key || "other"}`;
}

/**
 * The wiki-relative path for a page, including the leading `wiki/`. Used both
 * for writing the file and for landing on an existing page.
 *
 * @param type  page type (entity / concept / source / ...)
 * @param title page title
 */
export function pageRelPath(type: string, title: string): string {
  const slug = slugify(title);
  const dir = dirForType(type);
  return `wiki/${dir}/${slug}.md`;
}
