import 'reflect-metadata';
import { readFileSync } from 'fs';
import { parseFlowDocument, ParsedFlowDocument } from '../../backend/src/flows/flow-document';

/** Reads a flow JSON file and runs it through the same parser the import endpoint uses. */
export function loadFlowDocument(filePath: string): ParsedFlowDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${filePath} as JSON: ${(error as Error).message}`);
  }
  return parseFlowDocument(raw);
}

/** Message of a thrown error. Nest exceptions carry the readable text in `message`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
