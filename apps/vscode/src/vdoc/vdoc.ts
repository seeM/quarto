/*
 * vdoc.ts
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

import Token from "markdown-it/lib/token";
import { Position, TextDocument, Uri, Range } from "vscode";
import { isQuartoDoc } from "../core/doc";
import { MarkdownEngine } from "../markdown/engine";
import {
  isExecutableLanguageBlock,
  languageBlockAtPosition,
  languageNameFromBlock,
} from "../markdown/language";
import { embeddedLanguage, EmbeddedLanguage } from "./languages";
import { virtualDocUriFromEmbeddedContent } from "./vdoc-content";
import { virtualDocUriFromTempFile } from "./vdoc-tempfile";

export interface VirtualDoc {
  language: EmbeddedLanguage;
  content: string;
}

export async function virtualDoc(
  document: TextDocument,
  position: Position,
  engine: MarkdownEngine
): Promise<VirtualDoc | undefined> {
  // make sure this is a quarto doc
  if (!isQuartoDoc(document)) {
    return undefined;
  }

  // check if the cursor is in a fenced code block
  const tokens = await engine.parse(document);
  const language = languageAtPosition(tokens, position);

  if (language) {
    return virtualDocForLanguage(document, tokens, language);
  } else {
    return undefined;
  }
}

export function virtualDocForLanguage(
  document: TextDocument,
  tokens: Token[],
  language: EmbeddedLanguage
): VirtualDoc {
  // filter out lines that aren't of this language
  const lines: string[] = [];
  for (let i = 0; i < document.lineCount; i++) {
    lines.push(language.emptyLine || "");
  }
  for (const languageBlock of tokens.filter(isBlockOfLanguage(language))) {
    if (languageBlock.map) {
      for (
        let line = languageBlock.map[0] + 1;
        line < languageBlock.map[1] - 1 && line < document.lineCount;
        line++
      ) {
        lines[line] = document.lineAt(line).text;
      }
    }
  }
  
  // add a couple of blank lines at the bottom for padding
  for (let i=0; i<2; i++) {
    lines.push(language.emptyLine || ""); 
  }

  // return virtual doc
  return virtualDocForCode(lines, language);
  
}

export function virtualDocForCode(code: string[], language: EmbeddedLanguage) {
  
  const lines = [...code];

  if (language.inject) {
    lines.unshift(...language.inject);
  }

  return {
    language,
    content: lines.join("\n") + "\n",
  };
}

export type VirtualDocAction = 
  "completion" | 
  "hover"      | 
  "signature"  | 
  "definition" | 
  "format";

export type VirtualDocUri = { uri: Uri, cleanup?: () => Promise<void> };

export async function withVirtualDocUri<T>(virtualDocUri: VirtualDocUri, f: (uri: Uri) => Promise<T>) {
  try {
    return await f(virtualDocUri.uri);
  } finally {
    if (virtualDocUri.cleanup) {
      virtualDocUri.cleanup();
    }
  }
}

export async function virtualDocUri(
  virtualDoc: VirtualDoc, 
  parentUri: Uri, 
  action: VirtualDocAction
) : Promise<VirtualDocUri> {

  // format and definition actions use a transient local vdoc
  // (so they can get project-specific paths and formatting config)
  // note that we don't do this if the language requires vdoc re-use
  // (as the closing of the document will cause the extension to exit)
  const local = ["format", "definition"].includes(action) &&
                !virtualDoc.language.reuseVdoc;

  return virtualDoc.language.type === "content"
    ? { uri: virtualDocUriFromEmbeddedContent(virtualDoc, parentUri) }
    : await virtualDocUriFromTempFile(virtualDoc, parentUri.fsPath, local);
}

export function languageAtPosition(tokens: Token[], position: Position) {
  const block = languageBlockAtPosition(tokens, position);
  if (block) {
    return languageFromBlock(block);
  } else {
    return undefined;
  }
}

export function mainLanguage(
  tokens: Token[],
  filter?: (language: EmbeddedLanguage) => boolean
): EmbeddedLanguage | undefined {
  const languages: Record<string, number> = {};
  tokens.filter(isExecutableLanguageBlock).forEach((token) => {
    const embeddedLanguage = languageFromBlock(token);
    if (
      embeddedLanguage !== undefined &&
      (!filter || filter(embeddedLanguage))
    ) {
      const language = languageNameFromBlock(token);
      languages[language] = languages[language] ? languages[language] + 1 : 1;
    }
  });
  const languageName = Object.keys(languages).sort(
    (a, b) => languages[b] - languages[a]
  )[0];
  if (languageName) {
    return embeddedLanguage(languageName);
  } else {
    return undefined;
  }
}

export function languageFromBlock(token: Token) {
  const name = languageNameFromBlock(token);
  return embeddedLanguage(name);
}

export function isBlockOfLanguage(language: EmbeddedLanguage) {
  return (token: Token) => {
    return (
      isExecutableLanguageBlock(token) &&
      languageFromBlock(token)?.ids.some((id) => language.ids.includes(id))
    );
  };
}

// adjust position for inject
export function adjustedPosition(language: EmbeddedLanguage, pos: Position) {
  return new Position(pos.line + (language.inject?.length || 0), pos.character);
}

export function unadjustedPosition(language: EmbeddedLanguage, pos: Position) {
  return new Position(pos.line - (language.inject?.length || 0), pos.character);
}

export function unadjustedRange(language: EmbeddedLanguage, range: Range) {
  return new Range(
    unadjustedPosition(language, range.start),
    unadjustedPosition(language, range.end)
  );
}
