/** API contract shared with the backend. */
export type Box = [number, number, number, number]; // x1, y1, x2, y2 in image pixels

export interface Component {
  id: string;
  cls: string;
  box: Box;
  conf: number;
}

export interface TextItem {
  id: string;
  text: string;
  box: Box;
  conf: number;
  component_id: string | null;
  value: string | null;
}

export interface ReadResult {
  image: { width: number; height: number; name: string };
  components: Component[];
  texts: TextItem[];
  thresholds: { comp_conf: number; text_conf: number };
  source: "model" | "synthetic-fixture";
}

export interface Health {
  status: string;
  mode: "live" | "demo";
  classes: string[];
  /** Why the backend runs in demo mode, when it says so. */
  detail?: string | null;
}

export interface DemoEntry {
  id: string;
  title: string;
  image: string;
  result: string;
}

export interface ClassRow {
  class: string;
  n_gt: number;
  P: number;
  R: number;
  AP50: number;
  "AP50-95": number;
}
