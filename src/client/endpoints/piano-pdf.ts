import type { PianoEsame } from "../../types.js";

// Parser for the study plan PDF GOMP serves at Composer.aspx?PS=<id> (the
// plan's contents exist only in this form). Two stages, so the layout logic is
// testable without a PDF holding a student's name: `extractItems` turns the
// PDF into positioned text items, `parse` turns those items into exams.
//
// Layout (GOMP "Percorso formativo", same on every captured plan):
// - page 1 starts with a 12pt header (faculty, course, student, status);
//   every page ends with an 8pt footer. Both are skipped.
// - 10pt year titles ("Primo anno", "Secondo anno", …).
// - 9pt group titles at the left margin: "Insegnamenti obbligatori",
//   "Insegnamenti a scelta dello studente", "QUADRO n … a scelta tra:",
//   "Per la prova finale …", followed by a "Denominazione" header row.
// - one row per exam: "<codice> - <NOME>" at the left margin, then columns
//   Att. Form. (TAF), SSD, CFU, Ore, Tip. Att., Lingua at fixed x positions.
//   Long names wrap onto a second left-margin line about 11pt lower; the other
//   cells of a wrapped row sit up to ~6pt below the name's first line.
// - a totals row (CFU and Ore only, no name) after each group.

export interface PdfItem {
  x: number;
  y: number;
  text: string;
  size: number;
}

export async function extractItems(pdf: Buffer): Promise<PdfItem[][]> {
  // pdfjs is ESM-only and heavy; load it only when a plan is actually parsed.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({
    data: new Uint8Array(pdf),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    const pages: PdfItem[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(
        content.items
          .filter((i): i is typeof i & { str: string; transform: number[] } => "str" in i && i.str.trim() !== "")
          .map((i) => ({
            x: Math.round(i.transform[4]!),
            y: Math.round(i.transform[5]!),
            text: i.str.trim(),
            size: Math.round(Math.abs(i.transform[0]!)),
          })),
      );
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

const LEFT_MARGIN = 40; // names and titles start at x≈25
const ROW_BAND = 12; // other cells of a row sit at most this far below its name
const WRAP_GAP = 16; // a name's continuation line is this close below it
const ANNI: Record<string, string> = {
  primo: "1", secondo: "2", terzo: "3", quarto: "4", quinto: "5", sesto: "6",
};
// Column boundaries (left edge of the next column) from the header row:
// Att. Form. x=250, SSD x=316 (values start ~299), CFU x=358, Ore x=414.
const column = (x: number): "taf" | "ssd" | "cfu" | "other" | null =>
  x < 240 ? null : x < 290 ? "taf" : x < 350 ? "ssd" : x < 400 ? "cfu" : "other";

type Row = Omit<PianoEsame, "stato"> & { y: number; lastNameY: number };

export function parse(pages: PdfItem[][]): Array<Omit<PianoEsame, "stato">> {
  const rows: Row[] = [];
  let anno: string | null = null;
  let gruppo: string | null = null;

  for (const page of pages) {
    // Body text only: no 12pt header, no 8pt footer.
    const body = page.filter((i) => i.size >= 9 && i.size <= 10);
    const lefts = body.filter((i) => i.x < LEFT_MARGIN).sort((a, b) => b.y - a.y);
    const pageRows: Row[] = [];
    let last: Row | null = null;

    for (const item of lefts) {
      const exam = item.text.match(/^(\d{6,9})\s*-\s*(.+)$/);
      if (exam) {
        last = {
          codice: exam[1]!, nome: exam[2]!.trim(), cfu: null, annoCorso: anno,
          ssd: null, taf: null, gruppo, y: item.y, lastNameY: item.y,
        };
        pageRows.push(last);
        continue;
      }
      if (last && last.lastNameY - item.y < WRAP_GAP && item.text !== "Denominazione") {
        last.nome = `${last.nome} ${item.text}`;
        last.lastNameY = item.y;
        continue;
      }
      last = null;
      if (item.text === "Denominazione") continue;
      const year = item.text.match(/^(\w+) anno$/i);
      if (year && ANNI[year[1]!.toLowerCase()]) {
        anno = ANNI[year[1]!.toLowerCase()]!;
        gruppo = null;
      } else {
        gruppo = item.text;
      }
    }

    for (const item of body) {
      const col = column(item.x);
      if (!col || col === "other") continue;
      const row = pageRows.find((r) => item.y <= r.y && r.y - item.y <= ROW_BAND);
      if (!row) continue;
      if (col === "taf") row.taf = item.text;
      else if (col === "ssd") row.ssd = item.text;
      else row.cfu = Number.parseFloat(item.text.replace(",", ".")) || null;
    }
    rows.push(...pageRows);
  }
  return rows.map(({ y: _y, lastNameY: _l, ...e }) => e);
}
