export function readingText(html: string): string;
export function resolveAnchor(
  text: string,
  anchor: {
    hash: string;
    quote: string;
    start: number;
    end: number;
    prefix: string;
    suffix: string;
  },
  hash: string,
): { state: string; start: number | null; end: number | null };
