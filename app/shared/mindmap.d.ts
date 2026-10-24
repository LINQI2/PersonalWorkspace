export const mapFormat: string;
export function validateMap(value: any): { count: number; targets: string[] };
export function mapNodes(data: any): { node: any; parent: any; depth: number }[];
export function mapMarkdown(data: any, title: string): string;
export function newMap(title?: string): any;
