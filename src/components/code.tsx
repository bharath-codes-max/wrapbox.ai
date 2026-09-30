import { FileCode2, Terminal } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { CopyButton, cn } from "./ui";

type Lang = "json" | "ts" | "py" | "yaml" | "bash" | "toml" | "text";

const C = {
  key: "text-[#9db4ff]",
  str: "text-[#8be0b9]",
  num: "text-[#f6c177]",
  com: "text-[#5f6a88] italic",
  kw: "text-[#ff9ab0]",
  allow: "text-[#3fd49b] font-semibold",
  review: "text-[#f4b453] font-semibold",
  block: "text-[#ff6e8a] font-semibold",
  punct: "text-[#8a95b3]",
  plain: "text-[#dde3f3]",
};

const KW = /^(import|from|export|const|let|await|async|return|def|with|as|new|function|class|if|else|for|in|true|false|null|None|True|False|npm|npx|pip|brew|gh|wrapbox)$/;

function tokenizeLine(line: string, lang: Lang): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = line;
  let i = 0;
  const push = (cls: string, s: string) => out.push(<span key={i++} className={cls}>{s}</span>);

  // YAML keys at line start
  if (lang === "yaml") {
    const m = rest.match(/^(\s*-?\s*)([A-Za-z_][\w./-]*)(:)(?=\s|$)/);
    if (m) {
      push(C.plain, m[1]);
      push(C.key, m[2]);
      push(C.punct, m[3]);
      rest = rest.slice(m[0].length);
    }
  }

  const re =
    /(#.*$|\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(ALLOW|REVIEW|BLOCK)\b|\b([A-Za-z_]\w*)\b|(-?\b\d[\d_,.]*\b)|([{}[\](),:])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    if (m.index > last) push(C.plain, rest.slice(last, m.index));
    const [tok, com, str, dec, word, num, punct] = m;
    if (com !== undefined) {
      const isComment = com.startsWith("//") ? lang === "ts" : ["py", "yaml", "bash", "toml"].includes(lang);
      push(isComment ? C.com : C.plain, tok);
    } else if (str !== undefined) {
      const after = rest.slice(m.index + tok.length);
      push(lang === "json" && /^\s*:/.test(after) ? C.key : C.str, tok);
    } else if (dec !== undefined) push(dec === "ALLOW" ? C.allow : dec === "REVIEW" ? C.review : C.block, tok);
    else if (word !== undefined) push(KW.test(word) && lang !== "json" ? C.kw : C.plain, tok);
    else if (num !== undefined) push(C.num, tok);
    else if (punct !== undefined) push(C.punct, tok);
    last = m.index + tok.length;
  }
  if (last < rest.length) push(C.plain, rest.slice(last));
  return out;
}

export function Highlight({ code, lang }: { code: string; lang: Lang }) {
  return (
    <>
      {code.split("\n").map((l, idx) => (
        <Fragment key={idx}>
          {tokenizeLine(l, lang)}
          {"\n"}
        </Fragment>
      ))}
    </>
  );
}

export function CodeBlock({
  code,
  lang = "json",
  file,
  note,
  className,
  maxH,
  numbers = false,
  right,
}: {
  code: string;
  lang?: Lang;
  file?: string;
  note?: ReactNode;
  className?: string;
  maxH?: number;
  numbers?: boolean;
  right?: ReactNode;
}) {
  const lines = code.split("\n");
  return (
    <div className={cn("rounded-xl bg-code border border-code-line overflow-hidden text-left", className)}>
      {(file || note) && (
        <div className="flex items-center justify-between gap-3 px-3.5 h-9 border-b border-code-line">
          <div className="flex items-center gap-2 min-w-0">
            {lang === "bash" ? <Terminal className="size-3.5 text-[#8a95b3] shrink-0" /> : <FileCode2 className="size-3.5 text-[#8a95b3] shrink-0" />}
            <span className="font-mono text-[12px] text-[#dde3f3] truncate">{file}</span>
            {note && <span className="text-[11.5px] text-[#6c7692] truncate hidden sm:inline">{note}</span>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {right}
            <CopyButton text={code} className="text-[#8a95b3] hover:text-white" />
          </div>
        </div>
      )}
      <div className="overflow-auto scroll-thin" style={{ maxHeight: maxH }}>
        <pre className="font-mono text-[12.5px] leading-[1.65] px-3.5 py-3 flex">
          {numbers && (
            <span aria-hidden className="select-none pr-4 text-right text-[#3c4764]">
              {lines.map((_, i) => (
                <span key={i} className="block">
                  {i + 1}
                </span>
              ))}
            </span>
          )}
          <code className="flex-1 min-w-0">
            <Highlight code={code} lang={lang} />
          </code>
        </pre>
      </div>
    </div>
  );
}

export const json = (v: unknown) => JSON.stringify(v, null, 2);

export function InlineCmd({ cmd, className }: { cmd: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 rounded-xl bg-code border border-code-line pl-3.5 pr-1.5 h-10", className)}>
      <span className="text-[#5a82ff] font-mono text-[12.5px] select-none">$</span>
      <code className="flex-1 min-w-0 truncate font-mono text-[12.5px] text-[#dde3f3]">
        <Highlight code={cmd} lang="bash" />
      </code>
      <CopyButton text={cmd} className="text-[#8a95b3] hover:text-white" />
    </div>
  );
}
