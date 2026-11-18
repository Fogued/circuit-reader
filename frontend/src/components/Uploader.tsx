import { useRef, useState } from "react";
import type { DemoEntry } from "../types";
import { demoUrl } from "../lib/api";
import type { Mode } from "./Header";
import { ACCEPTED } from "../lib/files";

interface Props {
  mode: Mode;
  gallery: DemoEntry[];
  currentId: string | null;
  busy: boolean;
  onFile: (f: File) => void;
  onDemo: (e: DemoEntry) => void;
}

export function Uploader(p: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="uploader">
      <div
        className={`dropzone${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) p.onFile(f);
        }}
      >
        <input
          ref={input}
          type="file"
          accept={ACCEPTED.join(",")}
          hidden
          data-testid="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onFile(f);
            e.target.value = "";
          }}
        />
        <button type="button" className="primary" disabled={p.busy} onClick={() => input.current?.click()}>
          {p.busy ? "Reading..." : "Upload image"}
        </button>
        <span className="muted">or drop a PNG, JPEG or WebP here (max 10 MB)</span>
      </div>
      {p.gallery.length > 0 && (
        <ul className="gallery" aria-label="Bundled examples">
          {p.gallery.map((g) => (
            <li key={g.id}>
              <button type="button" className={`thumb${p.currentId === g.id ? " current" : ""}`} onClick={() => p.onDemo(g)} aria-label={`Open example: ${g.title}`}>
                <img src={demoUrl(g.image)} alt="" loading="lazy" />
                <span>{g.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
