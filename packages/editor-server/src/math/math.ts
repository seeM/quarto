/*
 * math.ts
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

import { jsonRpcMethod } from "core-server";
import { kMathMathjaxTypesetSvg, MathjaxTypesetOptions, MathServer } from "editor-types";

import jayson from 'jayson'

import { mathjaxTypeset } from "./mathjax";

export function mathServer() : MathServer {
  return {
    async mathjaxTypeset(tex: string, options: MathjaxTypesetOptions) {
      return mathjaxTypeset(tex, options);
    },
  };
}

export function mathServerMethods() : Record<string, jayson.Method> {
  const server = mathServer();
  const methods: Record<string, jayson.Method> = {
    [kMathMathjaxTypesetSvg]: jsonRpcMethod(args => server.mathjaxTypeset(args[0], args[1])),
  }
  return methods;
}

