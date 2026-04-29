import { Injectable } from "@angular/core";

export interface ParsedQueryError {
  summary: string;
  sqlContext: string | null;
  rawMessage: string;
}

@Injectable({
  providedIn: "root",
})
export class ErrorParsingService {
  parse(error: unknown): ParsedQueryError {
    const rawMessage = this.extractRawMessage(error).trim();
    const normalized = rawMessage.replace(/^sql\s+error:\s*/i, "").trim();

    return {
      summary: this.extractSummary(normalized),
      sqlContext: this.extractSqlContext(normalized),
      rawMessage,
    };
  }

  private extractRawMessage(error: unknown): string {
    if (typeof error === "string") {
      return error;
    }

    if (error instanceof Error) {
      return error.message;
    }

    if (this.isRecord(error) && typeof error["error"] === "string") {
      return error["error"];
    }

    if (this.isRecord(error) && typeof error["message"] === "string") {
      return error["message"];
    }

    try {
      return JSON.stringify(error);
    } catch {
      return "Unexpected query error";
    }
  }

  private extractSummary(message: string): string {
    const syntaxMatch = message.match(/syntax error at or near\s+"([^"]+)"/i);
    if (syntaxMatch) {
      return `syntax error at or near '${syntaxMatch[1]}'`;
    }

    const parserLine = message.match(/Parser Error:\s*([^\n]+)/i);
    if (parserLine) {
      return parserLine[1].trim();
    }

    const firstLine = message.split("\n").map((line) => line.trim()).find(Boolean);
    return firstLine ?? "Unexpected query error";
  }

  private extractSqlContext(message: string): string | null {
    const match = message.match(/(LINE\s+\d+:[^\n]*\n\s*\^)/i);
    if (match) {
      return match[1];
    }

    return null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
}
