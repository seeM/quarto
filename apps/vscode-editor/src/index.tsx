/*
 * index.ts
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

import React from "react";
import { createRoot } from 'react-dom/client';

import 'vscode-webview';

import { initEditorTranslations, initializeStore, readPrefsApi } from 'editor-ui';

import { App } from "./App";
import { visualEditorHostClient, visualEditorJsonRpcRequestTransport } from './sync';

import "editor-ui/src/styles";
import "./styles.scss"
import { applyDarkMode } from "./theme";

async function runEditor() {
  try {
    // connection to host
    const vscode = acquireVsCodeApi<unknown>();
    const request = visualEditorJsonRpcRequestTransport(vscode)
    const host = visualEditorHostClient(vscode, request);

    // get host context
    const context = await host.getHostContext();

    // initialize store and read initial prefs
    const store = await initializeStore(request);
    const prefs = readPrefsApi(store)

    // init localization
    await initEditorTranslations();

    // render
    const root = createRoot(document.getElementById('root')!);
    applyDarkMode(prefs);
    root.render(<App store={store} host={host} context={context} request={request}/>);
  } catch (error) {
    console.error(error);
  }
}

runEditor();


