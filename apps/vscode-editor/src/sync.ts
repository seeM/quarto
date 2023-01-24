/* eslint-disable prefer-const */
/*
 * connection.ts
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


import throttle from "lodash.throttle";

import { WebviewApi } from "vscode-webview";

import { 
  jsonRpcPostMessageRequestTransport, 
  jsonRpcPostMessageServer, 
  JsonRpcPostMessageTarget, 
  JsonRpcRequestTransport 
} from "core";

import { windowJsonRpcPostMessageTarget } from "core-browser";

import { 
  VSC_VE_ApplyExternalEdit, 
  VSC_VE_PrefsChanged,
  VSC_VE_GetMarkdownFromState,
  VSC_VE_Init, 
  VSC_VE_Focus,
  VSC_VEH_FlushEditorUpdates,
  VSC_VEH_SaveDocument,
  VSC_VEH_RenderDocument,
  VSC_VEH_SelectImage,
  VSC_VEH_EditorResourceUri,
  VSC_VEH_GetHostContext,
  VSC_VEH_ReopenSourceMode,
  VSC_VEH_OnEditorUpdated,
  VSC_VEH_OnEditorReady, 
  VSC_VEH_OpenURL,
  VSC_VEH_NavigateToXRef,
  VSC_VEH_NavigateToFile,
  VSC_VEH_ResolveImageUris,
  VSC_VEH_ResolveBase64Images,
  VSCodeVisualEditor, 
  VSCodeVisualEditorHost, 
  EditorServer,
  EditorServices,
  XRef,
  VSC_VE_IsFocused,
  Prefs,
} from "editor-types";

import { 
  editorJsonRpcServer, 
  editorJsonRpcServices 
} from "editor-core";

import { 
  EditorOperations, 
  PandocWriterOptions, 
  UpdateEvent 
} from "editor";

import { Command, EditorUIStore, readPrefsApi, t, updatePrefsApi } from "editor-ui";
import { applyDarkMode, editorThemeFromVSCode } from "./theme";


export interface VisualEditorHostClient extends VSCodeVisualEditorHost {
  vscode: WebviewApi<unknown>;
  server: EditorServer;
  services: EditorServices;
}

// json rpc request client
export function visualEditorJsonRpcRequestTransport(vscode: WebviewApi<unknown>) {
  const target = windowJsonRpcPostMessageTarget(vscode, window);
  const { request } = jsonRpcPostMessageRequestTransport(target);
  return request;
}

// interface to visual editor host (vs code extension)
export function visualEditorHostClient(
  vscode: WebviewApi<unknown>, 
  request: JsonRpcRequestTransport
) : VisualEditorHostClient {
  return {
    vscode,
    server: editorJsonRpcServer(request),
    services: editorJsonRpcServices(request),
    ...editorJsonRpcContainer(request)
  }
}



export async function syncEditorToHost(
  editor: EditorOperations, 
  host: VisualEditorHostClient,
  store: EditorUIStore,
  focus: boolean
)  {

  // get the current prefs
  const readPrefs = () => readPrefsApi(store);

  // determine markdown writer options from current state of the prefs store
  const writerOptions = () => {
    const prefs = readPrefs();
    const options: PandocWriterOptions = {};
    options.wrap = prefs.markdownWrap === "column" 
      ? String(prefs.markdownWrapColumn) 
      : prefs.markdownWrap;
    options.references = {
      location: prefs.markdownReferences,
      prefix: prefs.markdownReferencesPrefix || undefined
    }
    return options;
  }

  // apply the current theme (including bootstrap class on body)
  const applyTheme = (fontSize?: number) => {
    applyDarkMode(store);
    editor.applyTheme(editorThemeFromVSCode(fontSize));
  }

  // sync from text editor (throttled)
  const kThrottleDelayMs = 1000;
  const receiveEdit = throttle((markdown) => {
    editor.setMarkdown(markdown, writerOptions(), false)
      .finally(() => {
        // done
      });
  }, kThrottleDelayMs, { leading: false, trailing: true});

  // setup communication channel for host
  visualEditorHostServer(host.vscode, {
    async init(markdown: string) {

      // apply initial theme
      applyTheme();

      // init editor contents and sync cannonical version back to text editor
      const result = await editor.setMarkdown(markdown, writerOptions(), false);

      if (result) {

        // focus if requested
        if (focus) {
          editor.focus();
        }

        // visual editor => text editor (just send the state, host will call back for markdown)
        editor.subscribe(UpdateEvent, () => host.onEditorUpdated(editor.getStateJson()));

        // return canonical markdown
        return result.canonical;
      } else {

        return null;

      }
    },

    async prefsChanged(prefs: Prefs): Promise<void> {

      // save existing writer options (for comparison)
      const prevOptions = writerOptions();
    
      // update prefs
      await updatePrefsApi(store, prefs);

      // apply theme
      applyTheme(prefs.fontSize);

      // if markdown writing options changed then force a refresh
      const options = writerOptions();
      if (prevOptions.wrap !== options.wrap ||
          prevOptions.references?.location !== options.references?.location ||
          prevOptions.references?.prefix !== options.references?.prefix) {
        await host.onEditorUpdated(editor.getStateJson());
        await host.flushEditorUpdates();      
      }
    },

    async focus() {
      editor.focus();
    },

    async isFocused() {
      return editor.hasFocus();
    },

    async applyExternalEdit(markdown: string) {
      // only receive external text edits if we don't have focus (prevents circular updates)
      if (!editor.hasFocus() && !window.document.hasFocus()) {
        receiveEdit(markdown);
      }
    },

    async getMarkdownFromState(state: unknown): Promise<string> {
      const markdown = await editor.getMarkdownFromStateJson(state, writerOptions());
      return markdown;
    },
  })

  // let the host know we are ready
  await host.onEditorReady();  
}

export enum EditorHostCommands {
  Save = "33AFE7B9-24B0-42B4-8ED0-BE9C0015773D",
  Render = "297E16BF-B801-4DBB-BC1F-7F9C603B4456"
}

export function editorHostCommands(host: VisualEditorHostClient) {
  const commands: Command[] = [
    {
      id: EditorHostCommands.Save,
      menuText: t('commands:save_menu_text'),
      group: t('commands:group_file'),
      keymap: ['Mod-s'],
      isEnabled: () => true,
      isActive: () => false,
      execute: async () => {
        await host.saveDocument();
      },
    },
    {
      id: EditorHostCommands.Render,
      menuText: t('commands:render_menu_text'),
      group: t('commands:group_file'),
      keymap: ['Mod-Shift-k'],
      isEnabled: () => true,
      isActive: () => false,
      execute: async () => {
        await host.renderDocument();
      },
    }
  ];
  return commands;
}

// interface provided to visual editor host (vs code extension)
function visualEditorHostServer(vscode: WebviewApi<unknown>, editor: VSCodeVisualEditor) {

  // target for message bus
  const target: JsonRpcPostMessageTarget = {
    postMessage: (data) => {
      vscode.postMessage(data);
    },
    onMessage: (handler: (data: unknown) => void) => {
      const messageListener = (event: MessageEvent) => {
        const message = event.data; // The json data that the extension sent
        handler(message);
      };
      window.addEventListener('message', messageListener);
      return () => {
        window.removeEventListener('message', messageListener);
      }
    }
  };

  // create a server
  return jsonRpcPostMessageServer(target, {
    [VSC_VE_Init]: args => editor.init(args[0]),
    [VSC_VE_Focus]: () => editor.focus(),
    [VSC_VE_IsFocused]: () => editor.isFocused(),
    [VSC_VE_GetMarkdownFromState]: args => editor.getMarkdownFromState(args[0]),
    [VSC_VE_ApplyExternalEdit]: args => editor.applyExternalEdit(args[0]),
    [VSC_VE_PrefsChanged]: args => editor.prefsChanged(args[0]),
  })
}


function editorJsonRpcContainer(request: JsonRpcRequestTransport) : VSCodeVisualEditorHost {
  return {
    getHostContext: () => request(VSC_VEH_GetHostContext, []),
    reopenSourceMode: () => request(VSC_VEH_ReopenSourceMode, []),
    onEditorReady: () => request(VSC_VEH_OnEditorReady, []),
    onEditorUpdated: (state: unknown) => request(VSC_VEH_OnEditorUpdated, [state]),
    flushEditorUpdates: () => request(VSC_VEH_FlushEditorUpdates, []),
    saveDocument: () => request(VSC_VEH_SaveDocument, []),
    renderDocument: () => request(VSC_VEH_RenderDocument, []),
    editorResourceUri: (path: string) => request(VSC_VEH_EditorResourceUri, [path]),
    openURL: (url: string) => request(VSC_VEH_OpenURL, [url]),
    navigateToXRef: (file: string, xref: XRef) => request(VSC_VEH_NavigateToXRef, [file, xref]),
    navigateToFile: (file: string) => request(VSC_VEH_NavigateToFile, [file]),
    resolveImageUris: (uris: string[]) => request(VSC_VEH_ResolveImageUris, [uris]),
    resolveBase64Images: (base64Images: string[]) => request(VSC_VEH_ResolveBase64Images, [base64Images]),
    selectImage: () => request(VSC_VEH_SelectImage, [])
  };
}


