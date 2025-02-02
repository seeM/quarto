/*
 * diagnostics.ts
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


import { TextDocument } from "vscode-languageserver-textdocument";
import {
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range,
} from "vscode-languageserver/node";
import {
  docEditorContext,
  kEndColumn,
  kEndRow,
  kStartColumn,
  kStartRow,
  LintItem,
  quarto,
} from "../quarto/quarto";

export async function provideDiagnostics(
  doc: TextDocument
): Promise<Diagnostic[]> {
  // bail if no quarto connection
  if (!quarto) {
    return [];
  }

  if (quarto) {
    const context = docEditorContext(doc, Position.create(0, 0), true);
    const diagnostics = await quarto.getYamlDiagnostics(context);
    return diagnostics.map((item) => {
      return {
        severity: lintSeverity(item),
        range: Range.create(
          item[kStartRow],
          item[kStartColumn],
          item[kEndRow],
          item[kEndColumn]
        ),
        message: item.text,
        source: "quarto",
      };
    });
  } else {
    return [];
  }
}

function lintSeverity(item: LintItem) {
  if (item.type === "error") {
    return DiagnosticSeverity.Error;
  } else if (item.type === "warning") {
    return DiagnosticSeverity.Warning;
  } else {
    return DiagnosticSeverity.Information;
  }
}
